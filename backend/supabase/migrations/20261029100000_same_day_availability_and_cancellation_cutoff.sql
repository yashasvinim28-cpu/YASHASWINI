-- Allow booking remaining slots on provider-local today, and enforce the
-- customer cancellation cutoff in the database as well as the UI.
BEGIN;

CREATE OR REPLACE FUNCTION prevent_booking_on_closed_day() RETURNS TRIGGER AS $$
DECLARE
  v_settings _provider_availability_settings%ROWTYPE;
  v_slot RECORD;
  v_date DATE;
  v_duration INTEGER;
  v_horizon_slot UUID;
  v_slots_to_check UUID[];
BEGIN
  IF NEW.is_deleted OR NEW.status NOT IN ('PENDING','CONFIRMED','RESCHEDULE_REQUESTED','RESCHEDULED') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_settings FROM _provider_availability_settings WHERE provider_id=NEW.provider_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider availability is not configured'; END IF;
  SELECT COALESCE(NEW.duration_minutes,s.duration_minutes) INTO v_duration
  FROM _services s WHERE s.id=NEW.service_id AND s.provider_id=NEW.provider_id
    AND s.is_deleted=false AND s.approval_status='APPROVED';
  IF v_duration IS NULL THEN RAISE EXCEPTION 'Approved service not found for provider'; END IF;
  IF TG_OP='INSERT' THEN
    v_horizon_slot := NEW.availability_id;
    v_slots_to_check := ARRAY[NEW.availability_id];
  ELSIF NEW.availability_id IS DISTINCT FROM OLD.availability_id THEN
    v_horizon_slot := NEW.availability_id;
    v_slots_to_check := ARRAY[NEW.availability_id];
  ELSIF NEW.target_availability_id IS DISTINCT FROM OLD.target_availability_id
    AND NEW.target_availability_id IS NOT NULL THEN
    v_horizon_slot := NEW.target_availability_id;
    v_slots_to_check := ARRAY[NEW.target_availability_id];
  ELSIF NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes THEN
    v_slots_to_check := ARRAY[NEW.availability_id,NEW.target_availability_id];
  ELSE
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM _users u JOIN _provider_profiles p ON p.user_id=u.id
    WHERE u.id=NEW.provider_id AND u.role='PROVIDER' AND u.is_deleted=false AND p.is_deleted=false
  ) THEN RAISE EXCEPTION 'Provider is unavailable'; END IF;

  FOR v_slot IN SELECT a.id,a.start_time FROM _availabilities a
    WHERE a.id=ANY(v_slots_to_check) ORDER BY a.start_time LOOP
    v_date := (v_slot.start_time AT TIME ZONE v_settings.time_zone)::DATE;
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.provider_id::TEXT || ':' || v_date::TEXT, 0));
    IF EXISTS (SELECT 1 FROM _provider_day_blocks b WHERE b.provider_id=NEW.provider_id AND b.blocked_date=v_date) THEN
      RAISE EXCEPTION 'Provider is closed on the selected date';
    END IF;
    IF v_slot.id=v_horizon_slot AND (v_slot.start_time<=NOW()
      OR v_date < (NOW() AT TIME ZONE v_settings.time_zone)::DATE) THEN
      RAISE EXCEPTION 'Bookings must be scheduled for a future time';
    END IF;
    IF (v_slot.start_time AT TIME ZONE v_settings.time_zone)::TIME < v_settings.opens_at
      OR ((v_slot.start_time + v_duration * INTERVAL '1 minute') AT TIME ZONE v_settings.time_zone)::DATE <> v_date
      OR ((v_slot.start_time + v_duration * INTERVAL '1 minute') AT TIME ZONE v_settings.time_zone)::TIME > v_settings.closes_at THEN
      RAISE EXCEPTION 'Booking must start within provider working hours and finish by 6:00 PM';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cancel_customer_booking(p_booking_id UUID,p_customer_id UUID)
RETURNS SETOF _bookings AS $$
DECLARE
  b _bookings%ROWTYPE;
  v_start TIMESTAMPTZ;
  v_extension_slots UUID[];
BEGIN
  PERFORM expire_booking_holds();
  SELECT * INTO b FROM _bookings WHERE id=p_booking_id AND customer_id=p_customer_id
    AND is_deleted=false AND status IN ('PENDING','CONFIRMED','RESCHEDULED','RESCHEDULE_REQUESTED') FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT start_time INTO v_start FROM _availabilities WHERE id=b.availability_id;
  IF v_start<NOW()+INTERVAL '3 hours' THEN
    RAISE EXCEPTION 'Bookings can only be cancelled at least 3 hours before the start time';
  END IF;

  SELECT array_agg(slot_id) INTO v_extension_slots
  FROM _booking_extensions e CROSS JOIN LATERAL unnest(e.slot_ids) slot_id
  WHERE e.booking_id=b.id AND e.status='PENDING';

  PERFORM release_unclaimed_availability_slots(
    (SELECT array_agg(id) FROM _availabilities WHERE provider_id=b.provider_id
      AND start_time>=v_start AND start_time<v_start+b.duration_minutes*INTERVAL '1 minute' AND is_deleted=false),
    b.id, NULL
  );
  UPDATE _booking_extensions SET status='CANCELLED',reviewed_at=NOW()
    WHERE booking_id=b.id AND status='PENDING';
  PERFORM release_unclaimed_availability_slots(v_extension_slots,b.id,NULL);
  UPDATE _bookings SET status='CANCELLED',target_availability_id=NULL,
    reschedule_previous_status=NULL,lock_expires_at=NULL,updated_at=NOW() WHERE id=b.id;
  PERFORM emit_booking_notification(b.provider_id,'BOOKING_CANCELLED','A customer cancelled a booking.',
    jsonb_build_object('booking_id',b.id,'request_kind','BOOKING','result','CANCELLED'));
  RETURN QUERY SELECT * FROM _bookings WHERE id=b.id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_provider_availabilities(p_provider_id UUID)
RETURNS TABLE(id UUID,start_time TIMESTAMPTZ,end_time TIMESTAMPTZ,is_booked BOOLEAN)
LANGUAGE plpgsql AS $$
DECLARE v_settings _provider_availability_settings%ROWTYPE; v_today DATE;
BEGIN
  SELECT * INTO v_settings FROM _provider_availability_settings
    WHERE provider_id=p_provider_id AND is_enabled=true;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM _users u JOIN _provider_profiles p ON p.user_id=u.id
    WHERE u.id=p_provider_id AND u.role='PROVIDER' AND u.is_deleted=false AND p.is_deleted=false
  ) THEN RETURN; END IF;
  PERFORM ensure_provider_availability_window(p_provider_id);
  PERFORM expire_booking_holds();
  v_today := (NOW() AT TIME ZONE v_settings.time_zone)::DATE;
  RETURN QUERY SELECT a.id,a.start_time,a.end_time,
    (a.is_booked OR EXISTS(
      SELECT 1 FROM _bookings b JOIN _services s ON s.id=b.service_id
      JOIN _availabilities bs ON bs.id=b.availability_id
      WHERE b.provider_id=a.provider_id AND b.is_deleted=false
        AND b.status IN ('PENDING','CONFIRMED','RESCHEDULE_REQUESTED','RESCHEDULED')
        AND (b.lock_expires_at IS NULL OR b.lock_expires_at>NOW())
        AND a.start_time<bs.start_time+COALESCE(b.duration_minutes,s.duration_minutes)*INTERVAL '1 minute'
        AND a.end_time>bs.start_time
    ) OR EXISTS(
      SELECT 1 FROM _bookings b JOIN _services s ON s.id=b.service_id
      JOIN _availabilities ts ON ts.id=b.target_availability_id
      WHERE b.provider_id=a.provider_id AND b.is_deleted=false AND b.status='RESCHEDULE_REQUESTED'
        AND (b.lock_expires_at IS NULL OR b.lock_expires_at>NOW())
        AND a.start_time<ts.start_time+COALESCE(b.duration_minutes,s.duration_minutes)*INTERVAL '1 minute'
        AND a.end_time>ts.start_time
    ) OR EXISTS(
      SELECT 1 FROM _booking_extensions e
      WHERE e.status='PENDING' AND e.expires_at>NOW() AND a.id=ANY(e.slot_ids)
    )) AS is_booked
  FROM _availabilities a
  WHERE a.provider_id=p_provider_id AND a.is_deleted=false AND a.start_time>NOW()
    AND (a.start_time AT TIME ZONE v_settings.time_zone)::DATE >= v_today
    AND (a.start_time AT TIME ZONE v_settings.time_zone)::TIME>=v_settings.opens_at
    AND (a.end_time AT TIME ZONE v_settings.time_zone)::DATE=(a.start_time AT TIME ZONE v_settings.time_zone)::DATE
    AND (a.end_time AT TIME ZONE v_settings.time_zone)::TIME<=v_settings.closes_at
    AND NOT EXISTS(SELECT 1 FROM _provider_day_blocks d WHERE d.provider_id=p_provider_id
      AND d.blocked_date=(a.start_time AT TIME ZONE v_settings.time_zone)::DATE)
  ORDER BY a.start_time;
END;
$$;

REVOKE EXECUTE ON FUNCTION cancel_customer_booking(UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION cancel_customer_booking(UUID,UUID) TO service_role;
REVOKE EXECUTE ON FUNCTION get_provider_availabilities(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION get_provider_availabilities(UUID) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
