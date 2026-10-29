-- Lets providers cancel an active booking or propose a new time that the
-- customer can accept or decline. Customer initiated reschedules remain
-- provider approved.
BEGIN;

ALTER TABLE _bookings ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE _booking_reschedule_requests
  ADD COLUMN IF NOT EXISTS requested_by_role user_role NOT NULL DEFAULT 'CUSTOMER',
  ADD COLUMN IF NOT EXISTS requested_by UUID REFERENCES _users(id) ON DELETE SET NULL;

UPDATE _booking_reschedule_requests
SET requested_by=customer_id
WHERE requested_by IS NULL;

CREATE OR REPLACE FUNCTION record_booking_reschedule_request()
RETURNS TRIGGER AS $$
DECLARE
  v_requester_role user_role;
  v_requester UUID;
BEGIN
  IF NEW.status='RESCHEDULE_REQUESTED' AND OLD.status IS DISTINCT FROM 'RESCHEDULE_REQUESTED' THEN
    v_requester_role := COALESCE(NULLIF(current_setting('clickngo.reschedule_requester_role',true),''),'CUSTOMER')::user_role;
    v_requester := CASE WHEN v_requester_role='PROVIDER' THEN NEW.provider_id ELSE NEW.customer_id END;
    INSERT INTO _booking_reschedule_requests(
      booking_id,customer_id,provider_id,original_availability_id,target_availability_id,requested_by_role,requested_by
    ) VALUES (NEW.id,NEW.customer_id,NEW.provider_id,NEW.availability_id,NEW.target_availability_id,v_requester_role,v_requester);
  ELSIF OLD.status='RESCHEDULE_REQUESTED' AND NEW.status<>'RESCHEDULE_REQUESTED' THEN
    UPDATE _booking_reschedule_requests SET
      status=CASE WHEN NEW.status='RESCHEDULED' AND NEW.availability_id IS DISTINCT FROM OLD.availability_id THEN 'APPROVED'
        WHEN OLD.lock_expires_at IS NOT NULL AND OLD.lock_expires_at<=NOW() THEN 'EXPIRED' ELSE 'REJECTED' END,
      reviewed_at=NOW()
    WHERE booking_id=NEW.id AND status='PENDING';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_record_booking_reschedule_request ON _bookings;
CREATE TRIGGER trg_record_booking_reschedule_request
AFTER UPDATE OF status,target_availability_id ON _bookings
FOR EACH ROW EXECUTE FUNCTION record_booking_reschedule_request();

-- Preserve visibility for customer reschedule requests created before this
-- tracking table was installed.
INSERT INTO _booking_reschedule_requests(
  booking_id,customer_id,provider_id,original_availability_id,target_availability_id,requested_by_role,requested_by
)
SELECT b.id,b.customer_id,b.provider_id,b.availability_id,b.target_availability_id,'CUSTOMER',b.customer_id
FROM _bookings b
WHERE b.status='RESCHEDULE_REQUESTED' AND b.target_availability_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM _booking_reschedule_requests r WHERE r.booking_id=b.id AND r.status='PENDING');

CREATE OR REPLACE FUNCTION request_safe_reschedule(p_booking_id UUID,p_target_availability_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_booking RECORD;
  v_target_start TIMESTAMPTZ;
  v_slots UUID[];
  v_count INTEGER;
  v_busy BOOLEAN;
  v_chain BOOLEAN;
  v_requester_role TEXT;
BEGIN
  PERFORM expire_booking_holds();
  v_requester_role:=COALESCE(NULLIF(current_setting('clickngo.reschedule_requester_role',true),''),'CUSTOMER');
  SELECT b.id,b.customer_id,b.provider_id,b.availability_id,b.status,b.duration_minutes,
         current_slot.start_time current_start,s.title,customer.name customer_name,provider.name provider_name
  INTO v_booking
  FROM _bookings b JOIN _services s ON s.id=b.service_id
  JOIN _users customer ON customer.id=b.customer_id
  JOIN _users provider ON provider.id=b.provider_id
  JOIN _availabilities current_slot ON current_slot.id=b.availability_id
  WHERE b.id=p_booking_id AND b.is_deleted=false
    AND b.status IN ('PENDING','CONFIRMED','RESCHEDULED')
  FOR UPDATE OF b;
  IF NOT FOUND OR v_booking.current_start<=NOW() THEN RETURN FALSE; END IF;
  IF EXISTS (SELECT 1 FROM _booking_extensions WHERE booking_id=p_booking_id AND status='PENDING') THEN RETURN FALSE; END IF;

  SELECT start_time INTO v_target_start FROM _availabilities
  WHERE id=p_target_availability_id AND provider_id=v_booking.provider_id AND is_deleted=false
  FOR UPDATE NOWAIT;
  IF NOT FOUND OR v_target_start<=NOW() OR v_target_start>NOW()+INTERVAL '2 months'
     OR (v_target_start<v_booking.current_start+v_booking.duration_minutes*INTERVAL '1 minute'
       AND v_target_start+v_booking.duration_minutes*INTERVAL '1 minute'>v_booking.current_start) THEN RETURN FALSE; END IF;

  PERFORM id FROM _availabilities WHERE provider_id=v_booking.provider_id
    AND start_time>=v_target_start AND start_time<v_target_start+v_booking.duration_minutes*INTERVAL '1 minute'
    AND is_deleted=false ORDER BY start_time FOR UPDATE NOWAIT;
  SELECT array_agg(id ORDER BY start_time),count(*)::INTEGER,COALESCE(bool_or(is_booked),true),
    COALESCE(bool_and(start_time=v_target_start+((rn-1)*INTERVAL '15 minutes')
      AND end_time=start_time+INTERVAL '15 minutes'),false)
  INTO v_slots,v_count,v_busy,v_chain FROM (
    SELECT id,start_time,end_time,is_booked,row_number() OVER (ORDER BY start_time) rn
    FROM _availabilities WHERE provider_id=v_booking.provider_id
      AND start_time>=v_target_start AND start_time<v_target_start+v_booking.duration_minutes*INTERVAL '1 minute'
      AND is_deleted=false
  ) slots;
  IF v_count<>v_booking.duration_minutes/15 OR v_busy OR NOT v_chain OR v_slots[1]<>p_target_availability_id THEN RETURN FALSE; END IF;

  UPDATE _bookings SET target_availability_id=p_target_availability_id,status='RESCHEDULE_REQUESTED',
    reschedule_previous_status=v_booking.status,lock_expires_at=NOW()+INTERVAL '24 hours',updated_at=NOW()
  WHERE id=p_booking_id;
  IF v_requester_role='PROVIDER' THEN
    PERFORM emit_booking_notification(v_booking.customer_id,'RESCHEDULE_REQUEST',
      v_booking.provider_name||' proposed a new time for '||v_booking.title||'.',
      jsonb_build_object('booking_id',p_booking_id,'request_kind','RESCHEDULE','requested_by_role','PROVIDER',
        'current_start',v_booking.current_start,'requested_start',v_target_start));
  ELSE
    PERFORM emit_booking_notification(v_booking.provider_id,'RESCHEDULE_REQUEST',
      v_booking.customer_name||' requested a new time for '||v_booking.title||'.',
      jsonb_build_object('booking_id',p_booking_id,'request_kind','RESCHEDULE','requested_by_role','CUSTOMER',
        'current_start',v_booking.current_start,'requested_start',v_target_start));
  END IF;
  RETURN TRUE;
EXCEPTION WHEN lock_not_available THEN RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION request_customer_reschedule(p_booking_id UUID,p_customer_id UUID,p_target_availability_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _bookings WHERE id=p_booking_id AND customer_id=p_customer_id AND is_deleted=false) THEN
    RAISE EXCEPTION 'Booking not found or unauthorized';
  END IF;
  PERFORM set_config('clickngo.reschedule_requester_role','CUSTOMER',true);
  RETURN request_safe_reschedule(p_booking_id,p_target_availability_id);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION request_provider_reschedule(p_booking_id UUID,p_provider_id UUID,p_target_availability_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _bookings WHERE id=p_booking_id AND provider_id=p_provider_id AND is_deleted=false) THEN
    RAISE EXCEPTION 'Booking not found or unauthorized';
  END IF;
  PERFORM set_config('clickngo.reschedule_requester_role','PROVIDER',true);
  RETURN request_safe_reschedule(p_booking_id,p_target_availability_id);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION respond_provider_reschedule(p_booking_id UUID,p_customer_id UUID,p_approve BOOLEAN)
RETURNS SETOF _bookings AS $$
DECLARE
  b _bookings%ROWTYPE;
  v_request _booking_reschedule_requests%ROWTYPE;
  v_result _bookings%ROWTYPE;
BEGIN
  PERFORM expire_booking_holds();
  SELECT * INTO b FROM _bookings WHERE id=p_booking_id AND customer_id=p_customer_id
    AND status='RESCHEDULE_REQUESTED' AND is_deleted=false FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO v_request FROM _booking_reschedule_requests
  WHERE booking_id=b.id AND requested_by_role='PROVIDER' AND status='PENDING' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF p_approve THEN
    SELECT * INTO v_result FROM approve_safe_reschedule(b.id,b.provider_id);
    IF NOT FOUND THEN RETURN; END IF;
    PERFORM emit_booking_notification(b.provider_id,'RESCHEDULE_APPROVED','The customer accepted your proposed booking time.',
      jsonb_build_object('booking_id',b.id,'request_kind','RESCHEDULE','requested_by_role','PROVIDER','result','APPROVED'));
  ELSE
    UPDATE _bookings SET target_availability_id=NULL,status=COALESCE(reschedule_previous_status,'CONFIRMED'),
      reschedule_previous_status=NULL,lock_expires_at=NULL,updated_at=NOW() WHERE id=b.id;
    PERFORM emit_booking_notification(b.provider_id,'RESCHEDULE_REJECTED','The customer declined your proposed booking time.',
      jsonb_build_object('booking_id',b.id,'request_kind','RESCHEDULE','requested_by_role','PROVIDER','result','REJECTED'));
    SELECT * INTO v_result FROM _bookings WHERE id=b.id;
  END IF;
  RETURN NEXT v_result;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION provider_cancel_booking(p_booking_id UUID,p_provider_id UUID)
RETURNS SETOF _bookings AS $$
DECLARE
  b _bookings%ROWTYPE;
  v_start TIMESTAMPTZ;
  v_slots UUID[];
  v_extension_slots UUID[];
BEGIN
  PERFORM expire_booking_holds();
  SELECT * INTO b FROM _bookings WHERE id=p_booking_id AND provider_id=p_provider_id AND is_deleted=false
    AND status IN ('PENDING','CONFIRMED','RESCHEDULED','RESCHEDULE_REQUESTED') FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT start_time INTO v_start FROM _availabilities WHERE id=b.availability_id FOR UPDATE;
  IF v_start IS NULL OR v_start<=NOW() THEN RAISE EXCEPTION 'Only upcoming bookings can be cancelled'; END IF;
  SELECT array_agg(id) INTO v_slots FROM _availabilities
  WHERE provider_id=b.provider_id AND is_deleted=false
    AND ((start_time>=v_start AND start_time<v_start+COALESCE(b.duration_minutes,15)*INTERVAL '1 minute')
      OR (b.target_availability_id IS NOT NULL AND start_time>=(SELECT start_time FROM _availabilities WHERE id=b.target_availability_id)
        AND start_time<(SELECT start_time FROM _availabilities WHERE id=b.target_availability_id)+COALESCE(b.duration_minutes,15)*INTERVAL '1 minute'));
  SELECT array_agg(slot_id) INTO v_extension_slots FROM _booking_extensions e
    CROSS JOIN LATERAL unnest(e.slot_ids) slot_id WHERE e.booking_id=b.id AND e.status='PENDING';

  UPDATE _bookings SET status='CANCELLED',target_availability_id=NULL,reschedule_previous_status=NULL,
    lock_expires_at=NULL,cancellation_reason='CANCELLED_BY_PROVIDER',updated_at=NOW() WHERE id=b.id;
  UPDATE _booking_extensions SET status='CANCELLED',reviewed_at=NOW()
    WHERE booking_id=b.id AND status='PENDING';
  UPDATE _booking_cancellation_requests SET status='REJECTED',reviewed_at=NOW()
    WHERE booking_id=b.id AND status='PENDING';
  PERFORM release_unclaimed_availability_slots(v_slots,b.id,NULL);
  PERFORM release_unclaimed_availability_slots(v_extension_slots,b.id,NULL);
  PERFORM emit_booking_notification(b.customer_id,'BOOKING_CANCELLED','Your provider cancelled this booking.',
    jsonb_build_object('booking_id',b.id,'request_kind','BOOKING','result','CANCELLED','cancelled_by_role','PROVIDER'));
  RETURN QUERY SELECT * FROM _bookings WHERE id=b.id;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION request_safe_reschedule(UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION request_customer_reschedule(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION request_provider_reschedule(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION respond_provider_reschedule(UUID,UUID,BOOLEAN) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION provider_cancel_booking(UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION request_customer_reschedule(UUID,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION request_provider_reschedule(UUID,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION respond_provider_reschedule(UUID,UUID,BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION provider_cancel_booking(UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION request_safe_reschedule(UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION approve_safe_reschedule(UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION reject_safe_reschedule(UUID,UUID) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
