-- Complete customer cancellation requests and keep them compatible with
-- pending reschedule and extension holds.
BEGIN;

CREATE OR REPLACE FUNCTION guard_booking_request_against_pending_cancellation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status='RESCHEDULE_REQUESTED' AND EXISTS (
    SELECT 1 FROM _booking_cancellation_requests WHERE booking_id=NEW.id AND status='PENDING'
  ) THEN RAISE EXCEPTION 'A cancellation request is pending for this booking'; END IF;
  IF NEW.status='RESCHEDULE_REQUESTED' AND EXISTS (
    SELECT 1 FROM _booking_extensions WHERE booking_id=NEW.id AND status='PENDING'
  ) THEN RAISE EXCEPTION 'Resolve the pending extension request before requesting a reschedule'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_guard_booking_request_against_cancellation ON _bookings;
CREATE TRIGGER trg_guard_booking_request_against_cancellation
BEFORE UPDATE OF status,target_availability_id ON _bookings
FOR EACH ROW EXECUTE FUNCTION guard_booking_request_against_pending_cancellation();

CREATE OR REPLACE FUNCTION guard_extension_against_pending_cancellation()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM _booking_cancellation_requests WHERE booking_id=NEW.booking_id AND status='PENDING') THEN
    RAISE EXCEPTION 'A cancellation request is pending for this booking';
  END IF;
  IF EXISTS (SELECT 1 FROM _bookings WHERE id=NEW.booking_id AND status='RESCHEDULE_REQUESTED') THEN
    RAISE EXCEPTION 'Resolve the pending reschedule request before requesting an extension';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_guard_extension_against_cancellation ON _booking_extensions;
CREATE TRIGGER trg_guard_extension_against_cancellation
BEFORE INSERT ON _booking_extensions
FOR EACH ROW EXECUTE FUNCTION guard_extension_against_pending_cancellation();

CREATE OR REPLACE FUNCTION request_customer_cancellation(p_booking_id UUID,p_customer_id UUID)
RETURNS UUID AS $$
DECLARE
  b RECORD;
  v_request_id UUID;
  v_extension_slots UUID[];
BEGIN
  PERFORM expire_booking_holds();
  SELECT bk.id,bk.customer_id,bk.provider_id,bk.status,bk.availability_id,
         bk.duration_minutes,svc.title,a.start_time
  INTO b FROM _bookings bk JOIN _services svc ON svc.id=bk.service_id
    JOIN _availabilities a ON a.id=bk.availability_id
  WHERE bk.id=p_booking_id AND bk.customer_id=p_customer_id AND bk.is_deleted=false
    AND bk.status IN ('PENDING','CONFIRMED','RESCHEDULED','RESCHEDULE_REQUESTED')
  FOR UPDATE OF bk;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking is not eligible for a cancellation request'; END IF;
  IF b.start_time<=NOW() THEN RAISE EXCEPTION 'A started booking cannot be cancelled'; END IF;
  IF EXISTS (SELECT 1 FROM _booking_cancellation_requests WHERE booking_id=b.id AND status='PENDING') THEN
    RAISE EXCEPTION 'A cancellation request is already pending';
  END IF;

  -- A customer can still cancel while a time proposal is waiting for the
  -- provider. Withdraw that proposal first and restore its original booking.
  IF b.status='RESCHEDULE_REQUESTED' THEN
    UPDATE _bookings SET target_availability_id=NULL,status=COALESCE(reschedule_previous_status,'CONFIRMED'),
      reschedule_previous_status=NULL,lock_expires_at=NULL,updated_at=NOW() WHERE id=b.id;
  END IF;

  SELECT array_agg(slot_id) INTO v_extension_slots FROM _booking_extensions e
    CROSS JOIN LATERAL unnest(e.slot_ids) slot_id WHERE e.booking_id=b.id AND e.status='PENDING';
  UPDATE _booking_extensions SET status='CANCELLED',reviewed_at=NOW()
    WHERE booking_id=b.id AND status='PENDING';
  PERFORM release_unclaimed_availability_slots(v_extension_slots,b.id,NULL);

  INSERT INTO _booking_cancellation_requests(booking_id,customer_id,provider_id)
  VALUES (b.id,b.customer_id,b.provider_id) RETURNING id INTO v_request_id;
  PERFORM emit_booking_notification(b.provider_id,'RESCHEDULE_REQUEST',
    'A customer requested cancellation of '||b.title||'.',
    jsonb_build_object('booking_id',b.id,'cancellation_request_id',v_request_id,
      'request_kind','CANCELLATION','result','PENDING','start_time',b.start_time));
  RETURN v_request_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION respond_customer_cancellation(
  p_request_id UUID,p_provider_id UUID,p_approve BOOLEAN
) RETURNS SETOF _booking_cancellation_requests AS $$
DECLARE
  v_booking_id UUID;
  b _bookings%ROWTYPE;
  r _booking_cancellation_requests%ROWTYPE;
  v_start TIMESTAMPTZ;
  v_slots UUID[];
  v_extension_slots UUID[];
BEGIN
  PERFORM expire_booking_holds();
  SELECT booking_id INTO v_booking_id FROM _booking_cancellation_requests WHERE id=p_request_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO b FROM _bookings WHERE id=v_booking_id AND provider_id=p_provider_id AND is_deleted=false FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO r FROM _booking_cancellation_requests
    WHERE id=p_request_id AND booking_id=b.id AND provider_id=p_provider_id AND status='PENDING' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF NOT p_approve THEN
    UPDATE _booking_cancellation_requests SET status='REJECTED',reviewed_at=NOW() WHERE id=r.id;
    PERFORM emit_booking_notification(r.customer_id,'RESCHEDULE_REJECTED',
      'Your cancellation request was declined. Your booking remains active.',
      jsonb_build_object('booking_id',b.id,'cancellation_request_id',r.id,
        'request_kind','CANCELLATION','result','REJECTED'));
    RETURN QUERY SELECT * FROM _booking_cancellation_requests WHERE id=r.id;
    RETURN;
  END IF;

  IF b.status NOT IN ('PENDING','CONFIRMED','RESCHEDULED') THEN
    UPDATE _booking_cancellation_requests SET status='REJECTED',reviewed_at=NOW() WHERE id=r.id;
    RETURN QUERY SELECT * FROM _booking_cancellation_requests WHERE id=r.id;
    RETURN;
  END IF;
  SELECT start_time INTO v_start FROM _availabilities WHERE id=b.availability_id FOR UPDATE;
  IF v_start IS NULL OR v_start<=NOW() THEN
    UPDATE _booking_cancellation_requests SET status='REJECTED',reviewed_at=NOW() WHERE id=r.id;
    PERFORM emit_booking_notification(r.customer_id,'RESCHEDULE_REJECTED',
      'The cancellation request could not be approved because the booking has started.',
      jsonb_build_object('booking_id',b.id,'cancellation_request_id',r.id,
        'request_kind','CANCELLATION','result','REJECTED'));
    RETURN QUERY SELECT * FROM _booking_cancellation_requests WHERE id=r.id;
    RETURN;
  END IF;

  SELECT array_agg(id) INTO v_slots FROM _availabilities
  WHERE provider_id=b.provider_id AND is_deleted=false
    AND start_time>=v_start AND start_time<v_start+COALESCE(b.duration_minutes,15)*INTERVAL '1 minute';
  SELECT array_agg(slot_id) INTO v_extension_slots FROM _booking_extensions e
    CROSS JOIN LATERAL unnest(e.slot_ids) slot_id WHERE e.booking_id=b.id AND e.status='PENDING';
  UPDATE _bookings SET status='CANCELLED',target_availability_id=NULL,reschedule_previous_status=NULL,
    lock_expires_at=NULL,cancellation_reason='CANCELLED_BY_CUSTOMER',updated_at=NOW() WHERE id=b.id;
  UPDATE _booking_cancellation_requests SET status='APPROVED',reviewed_at=NOW() WHERE id=r.id;
  UPDATE _booking_extensions SET status='CANCELLED',reviewed_at=NOW()
    WHERE booking_id=b.id AND status='PENDING';
  PERFORM release_unclaimed_availability_slots(v_slots,b.id,NULL);
  PERFORM release_unclaimed_availability_slots(v_extension_slots,b.id,NULL);
  PERFORM emit_booking_notification(r.customer_id,'BOOKING_CANCELLED','Your cancellation request was approved.',
    jsonb_build_object('booking_id',b.id,'cancellation_request_id',r.id,
      'request_kind','CANCELLATION','result','APPROVED'));
  RETURN QUERY SELECT * FROM _booking_cancellation_requests WHERE id=r.id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION withdraw_customer_reschedule(p_booking_id UUID,p_customer_id UUID)
RETURNS SETOF _bookings AS $$
DECLARE
  b _bookings%ROWTYPE;
  r _booking_reschedule_requests%ROWTYPE;
BEGIN
  PERFORM expire_booking_holds();
  SELECT * INTO b FROM _bookings WHERE id=p_booking_id AND customer_id=p_customer_id
    AND status='RESCHEDULE_REQUESTED' AND is_deleted=false FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO r FROM _booking_reschedule_requests
    WHERE booking_id=b.id AND requested_by_role='CUSTOMER' AND status='PENDING' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE _bookings SET target_availability_id=NULL,status=COALESCE(reschedule_previous_status,'CONFIRMED'),
    reschedule_previous_status=NULL,lock_expires_at=NULL,updated_at=NOW() WHERE id=b.id;
  PERFORM emit_booking_notification(b.provider_id,'RESCHEDULE_REJECTED',
    'The customer withdrew their reschedule request.',
    jsonb_build_object('booking_id',b.id,'request_kind','RESCHEDULE','requested_by_role','CUSTOMER',
      'result','REJECTED','withdrawn',true));
  RETURN QUERY SELECT * FROM _bookings WHERE id=b.id;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION request_customer_cancellation(UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION respond_customer_cancellation(UUID,UUID,BOOLEAN) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION withdraw_customer_reschedule(UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION request_customer_cancellation(UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION respond_customer_cancellation(UUID,UUID,BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION withdraw_customer_reschedule(UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION release_unclaimed_availability_slots(UUID[],UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION emit_booking_notification(UUID,notification_type,TEXT,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION expire_booking_holds() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
