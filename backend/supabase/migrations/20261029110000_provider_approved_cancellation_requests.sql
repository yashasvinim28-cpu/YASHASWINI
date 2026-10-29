-- Adds an auditable provider-approved cancellation request while preserving
-- the booking and its slot until the provider accepts it.
BEGIN;

CREATE TABLE IF NOT EXISTS _booking_cancellation_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES _bookings(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES _users(id) ON DELETE RESTRICT,
  provider_id UUID NOT NULL REFERENCES _users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);
ALTER TABLE _booking_cancellation_requests ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_pending_cancellation_per_booking
  ON _booking_cancellation_requests(booking_id) WHERE status='PENDING';
CREATE INDEX IF NOT EXISTS idx_cancellation_requests_provider_status
  ON _booking_cancellation_requests(provider_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS _booking_reschedule_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES _bookings(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES _users(id) ON DELETE RESTRICT,
  provider_id UUID NOT NULL REFERENCES _users(id) ON DELETE RESTRICT,
  original_availability_id UUID NOT NULL REFERENCES _availabilities(id) ON DELETE RESTRICT,
  target_availability_id UUID NOT NULL REFERENCES _availabilities(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','APPROVED','REJECTED','EXPIRED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);
ALTER TABLE _booking_reschedule_requests ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_pending_reschedule_request_per_booking
  ON _booking_reschedule_requests(booking_id) WHERE status='PENDING';
CREATE INDEX IF NOT EXISTS idx_reschedule_requests_provider_status
  ON _booking_reschedule_requests(provider_id,status,created_at DESC);

CREATE OR REPLACE FUNCTION record_booking_reschedule_request()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status='RESCHEDULE_REQUESTED' AND OLD.status IS DISTINCT FROM 'RESCHEDULE_REQUESTED' THEN
    INSERT INTO _booking_reschedule_requests(
      booking_id,customer_id,provider_id,original_availability_id,target_availability_id
    ) VALUES (NEW.id,NEW.customer_id,NEW.provider_id,NEW.availability_id,NEW.target_availability_id);
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

CREATE OR REPLACE FUNCTION request_customer_cancellation(p_booking_id UUID,p_customer_id UUID)
RETURNS UUID AS $$
DECLARE
  b RECORD;
  v_start TIMESTAMPTZ;
  v_request_id UUID;
BEGIN
  PERFORM expire_booking_holds();
  SELECT bk.id,bk.customer_id,bk.provider_id,bk.status,bk.availability_id,bk.duration_minutes,
         svc.title,a.start_time
  INTO b FROM _bookings bk JOIN _services svc ON svc.id=bk.service_id
    JOIN _availabilities a ON a.id=bk.availability_id
  WHERE bk.id=p_booking_id AND bk.customer_id=p_customer_id AND bk.is_deleted=false
    AND bk.status IN ('PENDING','CONFIRMED','RESCHEDULED')
  FOR UPDATE OF bk;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking is not eligible for a cancellation request'; END IF;
  v_start:=b.start_time;
  IF v_start<NOW()+INTERVAL '3 hours' THEN
    RAISE EXCEPTION 'Cancellation requests must be made at least 3 hours before the booking';
  END IF;
  IF EXISTS (SELECT 1 FROM _booking_extensions WHERE booking_id=b.id AND status='PENDING') THEN
    RAISE EXCEPTION 'Resolve the pending extension request before requesting cancellation';
  END IF;
  IF EXISTS (SELECT 1 FROM _booking_cancellation_requests WHERE booking_id=b.id AND status='PENDING') THEN
    RAISE EXCEPTION 'A cancellation request is already pending';
  END IF;

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
  v_extension_slots UUID[];
BEGIN
  SELECT booking_id INTO v_booking_id FROM _booking_cancellation_requests WHERE id=p_request_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO b FROM _bookings WHERE id=v_booking_id AND provider_id=p_provider_id
    AND is_deleted=false FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO r FROM _booking_cancellation_requests WHERE id=p_request_id
    AND booking_id=b.id AND provider_id=p_provider_id AND status='PENDING' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF NOT p_approve THEN
    UPDATE _booking_cancellation_requests SET status='REJECTED',reviewed_at=NOW() WHERE id=r.id;
    PERFORM emit_booking_notification(r.customer_id,'RESCHEDULE_REJECTED',
      'Your cancellation request was rejected. Your booking remains active.',
      jsonb_build_object('booking_id',b.id,'cancellation_request_id',r.id,
        'request_kind','CANCELLATION','result','REJECTED'));
    RETURN QUERY SELECT * FROM _booking_cancellation_requests WHERE id=r.id;
    RETURN;
  END IF;

  IF b.status NOT IN ('PENDING','CONFIRMED','RESCHEDULED') THEN
    UPDATE _booking_cancellation_requests SET status='REJECTED',reviewed_at=NOW() WHERE id=r.id;
    PERFORM emit_booking_notification(r.customer_id,'RESCHEDULE_REJECTED',
      'Your cancellation request could not be approved because the booking is no longer active.',
      jsonb_build_object('booking_id',b.id,'cancellation_request_id',r.id,
        'request_kind','CANCELLATION','result','REJECTED'));
    RETURN QUERY SELECT * FROM _booking_cancellation_requests WHERE id=r.id;
    RETURN;
  END IF;

  SELECT start_time INTO v_start FROM _availabilities WHERE id=b.availability_id FOR UPDATE;
  IF v_start IS NULL OR v_start<=NOW() THEN RETURN; END IF;
  SELECT array_agg(slot_id) INTO v_extension_slots
  FROM _booking_extensions e CROSS JOIN LATERAL unnest(e.slot_ids) slot_id
  WHERE e.booking_id=b.id AND e.status='PENDING';

  UPDATE _bookings SET status='CANCELLED',target_availability_id=NULL,
    reschedule_previous_status=NULL,lock_expires_at=NULL,updated_at=NOW()
  WHERE id=b.id;
  UPDATE _booking_cancellation_requests SET status='APPROVED',reviewed_at=NOW() WHERE id=r.id;
  UPDATE _booking_extensions SET status='CANCELLED',reviewed_at=NOW()
    WHERE booking_id=b.id AND status='PENDING';
  PERFORM release_unclaimed_availability_slots(
    (SELECT array_agg(id) FROM _availabilities WHERE provider_id=b.provider_id
      AND start_time>=v_start AND start_time<v_start+b.duration_minutes*INTERVAL '1 minute' AND is_deleted=false),
    b.id,NULL);
  PERFORM release_unclaimed_availability_slots(v_extension_slots,b.id,NULL);
  PERFORM emit_booking_notification(r.customer_id,'BOOKING_CANCELLED',
    'Your cancellation request was approved and the booking was cancelled.',
    jsonb_build_object('booking_id',b.id,'cancellation_request_id',r.id,
      'request_kind','CANCELLATION','result','APPROVED'));
  RETURN QUERY SELECT * FROM _booking_cancellation_requests WHERE id=r.id;
EXCEPTION WHEN lock_not_available THEN RETURN;
END;
$$ LANGUAGE plpgsql;

-- Prevent a new reschedule or extension from racing with a pending cancellation.
CREATE OR REPLACE FUNCTION guard_booking_request_against_pending_cancellation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status='RESCHEDULE_REQUESTED' AND EXISTS (
    SELECT 1 FROM _booking_cancellation_requests WHERE booking_id=NEW.id AND status='PENDING'
  ) THEN
    RAISE EXCEPTION 'A cancellation request is pending for this booking';
  END IF;
  IF NEW.status='RESCHEDULE_REQUESTED' AND EXISTS (
    SELECT 1 FROM _booking_extensions WHERE booking_id=NEW.id AND status='PENDING'
  ) THEN
    RAISE EXCEPTION 'Resolve the pending extension request before requesting a reschedule';
  END IF;
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
  IF EXISTS (SELECT 1 FROM _booking_cancellation_requests
    WHERE booking_id=NEW.booking_id AND status='PENDING') THEN
    RAISE EXCEPTION 'A cancellation request is pending for this booking';
  END IF;
  IF EXISTS (SELECT 1 FROM _bookings
    WHERE id=NEW.booking_id AND status='RESCHEDULE_REQUESTED') THEN
    RAISE EXCEPTION 'Resolve the pending reschedule request before requesting an extension';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_guard_extension_against_cancellation ON _booking_extensions;
CREATE TRIGGER trg_guard_extension_against_cancellation
BEFORE INSERT ON _booking_extensions
FOR EACH ROW EXECUTE FUNCTION guard_extension_against_pending_cancellation();

-- The database remains the authority for the three-hour reschedule cutoff.
CREATE OR REPLACE FUNCTION guard_reschedule_request_cutoff()
RETURNS TRIGGER AS $$
DECLARE v_start TIMESTAMPTZ;
BEGIN
  IF NEW.status='RESCHEDULE_REQUESTED' AND OLD.status IS DISTINCT FROM 'RESCHEDULE_REQUESTED' THEN
    SELECT start_time INTO v_start FROM _availabilities WHERE id=NEW.availability_id;
    IF v_start IS NULL OR v_start<NOW()+INTERVAL '3 hours' THEN
      RAISE EXCEPTION 'Reschedule requests must be made at least 3 hours before the booking';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_guard_reschedule_request_cutoff ON _bookings;
CREATE TRIGGER trg_guard_reschedule_request_cutoff
BEFORE UPDATE OF status ON _bookings
FOR EACH ROW EXECUTE FUNCTION guard_reschedule_request_cutoff();

-- If approval-time validation finds a lost or conflicting target slot, clear
-- the request and its target hold in the same transaction, retaining the old slot.
CREATE OR REPLACE FUNCTION approve_safe_reschedule(p_booking_id UUID,p_provider_id UUID)
RETURNS SETOF _bookings AS $$
DECLARE
  b _bookings%ROWTYPE;
  v_old_start TIMESTAMPTZ;
  v_new_start TIMESTAMPTZ;
  v_slots UUID[];
  v_count INTEGER;
  v_busy BOOLEAN;
  v_chain BOOLEAN;
  v_customer_id UUID;
BEGIN
  PERFORM expire_booking_holds();
  SELECT * INTO b FROM _bookings WHERE id=p_booking_id AND provider_id=p_provider_id
    AND status='RESCHEDULE_REQUESTED' AND lock_expires_at>NOW() AND is_deleted=false FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT customer_id INTO v_customer_id FROM _bookings WHERE id=b.id;
  SELECT start_time INTO v_old_start FROM _availabilities WHERE id=b.availability_id;
  SELECT start_time INTO v_new_start FROM _availabilities WHERE id=b.target_availability_id
    AND provider_id=p_provider_id AND is_deleted=false;

  IF v_old_start IS NOT NULL AND v_new_start IS NOT NULL AND b.duration_minutes IS NOT NULL THEN
    PERFORM id FROM _availabilities WHERE provider_id=p_provider_id
      AND start_time>=v_new_start AND start_time<v_new_start+b.duration_minutes*INTERVAL '1 minute'
      AND is_deleted=false ORDER BY start_time FOR UPDATE NOWAIT;
    SELECT array_agg(id ORDER BY start_time),count(*)::integer,coalesce(bool_or(is_booked),true),
      coalesce(bool_and(start_time=v_new_start+((rn-1)*INTERVAL '15 minutes')
        AND end_time=start_time+INTERVAL '15 minutes'),false)
    INTO v_slots,v_count,v_busy,v_chain FROM (
      SELECT id,start_time,end_time,is_booked,row_number() over(order by start_time) rn
      FROM _availabilities WHERE provider_id=p_provider_id
        AND start_time>=v_new_start AND start_time<v_new_start+b.duration_minutes*INTERVAL '1 minute'
        AND is_deleted=false
    ) a;
    IF v_count=b.duration_minutes/15 AND NOT v_busy AND v_chain AND v_slots[1]=b.target_availability_id THEN
      PERFORM release_unclaimed_availability_slots(
        (SELECT array_agg(id) FROM _availabilities WHERE provider_id=p_provider_id
          AND start_time>=v_old_start AND start_time<v_old_start+b.duration_minutes*INTERVAL '1 minute' AND is_deleted=false),
        b.id,NULL);
      UPDATE _availabilities SET is_booked=true WHERE id=ANY(v_slots);
      UPDATE _bookings SET availability_id=b.target_availability_id,target_availability_id=NULL,
        status='RESCHEDULED',reschedule_previous_status=NULL,lock_expires_at=NULL,updated_at=NOW()
      WHERE id=p_booking_id;
      PERFORM emit_booking_notification(v_customer_id,'RESCHEDULE_APPROVED','Your reschedule request was approved.',
        jsonb_build_object('booking_id',p_booking_id,'request_kind','RESCHEDULE','result','APPROVED','start_time',v_new_start));
      RETURN QUERY SELECT * FROM _bookings WHERE id=p_booking_id;
      RETURN;
    END IF;
  END IF;

  UPDATE _bookings SET target_availability_id=NULL,
    status=COALESCE(reschedule_previous_status,'CONFIRMED'),reschedule_previous_status=NULL,
    lock_expires_at=NULL,updated_at=NOW() WHERE id=p_booking_id;
  PERFORM release_unclaimed_availability_slots(
    (SELECT array_agg(id) FROM _availabilities WHERE provider_id=p_provider_id
      AND start_time>=COALESCE(v_new_start,'-infinity'::timestamptz)
      AND start_time<COALESCE(v_new_start,'-infinity'::timestamptz)+b.duration_minutes*INTERVAL '1 minute'
      AND is_deleted=false),b.id,NULL);
  PERFORM emit_booking_notification(v_customer_id,'RESCHEDULE_REJECTED',
    'The requested time was no longer available. Your original booking is unchanged.',
    jsonb_build_object('booking_id',p_booking_id,'request_kind','RESCHEDULE','result','REJECTED'));
  RETURN;
EXCEPTION WHEN lock_not_available THEN
  SELECT customer_id INTO v_customer_id FROM _bookings
    WHERE id=p_booking_id AND provider_id=p_provider_id AND status='RESCHEDULE_REQUESTED';
  UPDATE _bookings SET target_availability_id=NULL,
    status=COALESCE(reschedule_previous_status,'CONFIRMED'),reschedule_previous_status=NULL,
    lock_expires_at=NULL,updated_at=NOW() WHERE id=p_booking_id AND provider_id=p_provider_id
      AND status='RESCHEDULE_REQUESTED';
  IF v_customer_id IS NOT NULL THEN
    PERFORM emit_booking_notification(v_customer_id,'RESCHEDULE_REJECTED',
      'The requested time could not be locked. Your original booking is unchanged.',
      jsonb_build_object('booking_id',p_booking_id,'request_kind','RESCHEDULE','result','REJECTED'));
  END IF;
  RETURN;
END;
$$ LANGUAGE plpgsql;

-- Treat a stale extension approval as a rejection, freeing its held slots and
-- leaving the original booking duration untouched.
CREATE OR REPLACE FUNCTION respond_booking_extension(p_extension_id UUID,p_provider_id UUID,p_approve BOOLEAN)
RETURNS SETOF _booking_extensions AS $$
DECLARE
  e _booking_extensions%ROWTYPE;
  b _bookings%ROWTYPE;
  v_booking_id UUID;
  v_start TIMESTAMPTZ;
  v_expected_start TIMESTAMPTZ;
  v_slot_ids UUID[];
  v_slot_count INTEGER;
  v_valid_chain BOOLEAN;
  v_settings _provider_availability_settings%ROWTYPE;
  v_valid BOOLEAN := false;
BEGIN
  PERFORM expire_booking_holds();
  SELECT booking_id INTO v_booking_id FROM _booking_extensions WHERE id=p_extension_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO b FROM _bookings WHERE id=v_booking_id AND provider_id=p_provider_id
    AND is_deleted=false AND status IN ('PENDING','CONFIRMED','RESCHEDULED') FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO e FROM _booking_extensions WHERE id=p_extension_id AND booking_id=b.id
    AND status='PENDING' AND expires_at>NOW() FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF p_approve THEN
    SELECT start_time INTO v_start FROM _availabilities WHERE id=b.availability_id AND is_deleted=false;
    v_expected_start:=v_start+b.duration_minutes*INTERVAL '1 minute';
    PERFORM id FROM _availabilities WHERE id=ANY(e.slot_ids) ORDER BY start_time FOR UPDATE NOWAIT;
    SELECT array_agg(id ORDER BY start_time),count(*)::integer,
      coalesce(bool_and(is_booked AND NOT is_deleted
        AND start_time=v_expected_start+((rn-1)*INTERVAL '15 minutes')
        AND end_time=start_time+INTERVAL '15 minutes'),false)
    INTO v_slot_ids,v_slot_count,v_valid_chain FROM (
      SELECT id,start_time,end_time,is_booked,is_deleted,row_number() over(order by start_time) rn
      FROM _availabilities WHERE id=ANY(e.slot_ids)
    ) held_slots;
    SELECT * INTO v_settings FROM _provider_availability_settings WHERE provider_id=b.provider_id;
    v_valid := v_start>NOW() AND v_slot_count=e.additional_minutes/15
      AND v_valid_chain AND v_slot_ids=e.slot_ids
      AND v_settings.is_enabled=true
      AND (v_expected_start AT TIME ZONE v_settings.time_zone)::TIME>=v_settings.opens_at
      AND ((v_expected_start+e.additional_minutes*INTERVAL '1 minute') AT TIME ZONE v_settings.time_zone)::DATE
        =(v_expected_start AT TIME ZONE v_settings.time_zone)::DATE
      AND ((v_expected_start+e.additional_minutes*INTERVAL '1 minute') AT TIME ZONE v_settings.time_zone)::TIME
        <=v_settings.closes_at
      AND NOT EXISTS(SELECT 1 FROM _provider_day_blocks d WHERE d.provider_id=b.provider_id
        AND d.blocked_date=(v_expected_start AT TIME ZONE v_settings.time_zone)::DATE)
      AND NOT EXISTS (
        SELECT 1 FROM _bookings other_booking
        JOIN _services other_service ON other_service.id=other_booking.service_id
        JOIN _availabilities other_start ON other_start.id=other_booking.availability_id
        LEFT JOIN _availabilities other_target ON other_target.id=other_booking.target_availability_id
        WHERE other_booking.id<>b.id AND other_booking.provider_id=b.provider_id
          AND other_booking.is_deleted=false
          AND other_booking.status IN ('PENDING','CONFIRMED','RESCHEDULE_REQUESTED','RESCHEDULED')
          AND (other_booking.lock_expires_at IS NULL OR other_booking.lock_expires_at>NOW())
          AND (
            (v_expected_start<other_start.start_time+COALESCE(other_booking.duration_minutes,other_service.duration_minutes)*INTERVAL '1 minute'
              AND v_expected_start+e.additional_minutes*INTERVAL '1 minute'>other_start.start_time)
            OR (other_booking.status='RESCHEDULE_REQUESTED' AND other_target.id IS NOT NULL
              AND v_expected_start<other_target.start_time+COALESCE(other_booking.duration_minutes,other_service.duration_minutes)*INTERVAL '1 minute'
              AND v_expected_start+e.additional_minutes*INTERVAL '1 minute'>other_target.start_time)
          )
      );
    IF v_valid THEN
      UPDATE _booking_extensions SET status='APPROVED',reviewed_at=NOW() WHERE id=e.id;
      UPDATE _bookings SET duration_minutes=duration_minutes+e.additional_minutes,
        extension_amount_due=extension_amount_due+e.additional_price,updated_at=NOW() WHERE id=b.id;
      PERFORM emit_booking_notification(b.customer_id,'RESCHEDULE_APPROVED',
        'Your '||e.additional_minutes||' minute session extension was approved.',
        jsonb_build_object('booking_id',b.id,'extension_id',e.id,'request_kind','EXTENSION','result','APPROVED',
          'additional_minutes',e.additional_minutes,'additional_price',e.additional_price));
    ELSE
      PERFORM release_unclaimed_availability_slots(e.slot_ids,b.id,e.id);
      UPDATE _booking_extensions SET status='REJECTED',reviewed_at=NOW() WHERE id=e.id;
      PERFORM emit_booking_notification(b.customer_id,'RESCHEDULE_REJECTED',
        'The requested extension is no longer available. Your original booking is unchanged.',
        jsonb_build_object('booking_id',b.id,'extension_id',e.id,'request_kind','EXTENSION','result','REJECTED'));
    END IF;
  ELSE
    PERFORM release_unclaimed_availability_slots(e.slot_ids,b.id,e.id);
    UPDATE _booking_extensions SET status='REJECTED',reviewed_at=NOW() WHERE id=e.id;
    PERFORM emit_booking_notification(b.customer_id,'RESCHEDULE_REJECTED',
      'Your session extension request was rejected.',
      jsonb_build_object('booking_id',b.id,'extension_id',e.id,'request_kind','EXTENSION','result','REJECTED'));
  END IF;
  RETURN QUERY SELECT * FROM _booking_extensions WHERE id=e.id;
EXCEPTION WHEN lock_not_available THEN
  SELECT ext.* INTO e FROM _booking_extensions ext JOIN _bookings owned_booking ON owned_booking.id=ext.booking_id
    WHERE ext.id=p_extension_id AND ext.status='PENDING' AND owned_booking.provider_id=p_provider_id FOR UPDATE OF ext;
  IF FOUND THEN
    PERFORM release_unclaimed_availability_slots(e.slot_ids,e.booking_id,e.id);
    UPDATE _booking_extensions SET status='REJECTED',reviewed_at=NOW() WHERE id=e.id;
    PERFORM emit_booking_notification(e.requested_by,'RESCHEDULE_REJECTED',
      'The requested extension could not be reserved. Your original booking is unchanged.',
      jsonb_build_object('booking_id',e.booking_id,'extension_id',e.id,'request_kind','EXTENSION','result','REJECTED'));
    RETURN QUERY SELECT * FROM _booking_extensions WHERE id=e.id;
  END IF;
  RETURN;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION request_customer_cancellation(UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION respond_customer_cancellation(UUID,UUID,BOOLEAN) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION request_customer_cancellation(UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION respond_customer_cancellation(UUID,UUID,BOOLEAN) TO service_role;
REVOKE EXECUTE ON FUNCTION approve_safe_reschedule(UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION approve_safe_reschedule(UUID,UUID) TO service_role;
REVOKE EXECUTE ON FUNCTION respond_booking_extension(UUID,UUID,BOOLEAN) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION respond_booking_extension(UUID,UUID,BOOLEAN) TO service_role;
REVOKE EXECUTE ON FUNCTION guard_booking_request_against_pending_cancellation() FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION guard_extension_against_pending_cancellation() FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION guard_reschedule_request_cutoff() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
