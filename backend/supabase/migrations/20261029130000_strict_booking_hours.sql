-- Enforce the product-wide 10:00 AM–6:00 PM limit in PostgreSQL.
-- Existing availability and booking records are preserved; historical out-of-window
-- availability is hidden and new/updated active bookings cannot use it.
BEGIN;

CREATE OR REPLACE FUNCTION enforce_booking_public_hours() RETURNS TRIGGER AS $$
DECLARE
  v_time_zone TEXT;
  v_duration INTEGER;
  v_slot_id UUID;
  v_start TIMESTAMPTZ;
  v_local_start TIMESTAMP;
  v_local_end TIMESTAMP;
BEGIN
  IF NEW.is_deleted OR NEW.status NOT IN ('PENDING','CONFIRMED','RESCHEDULE_REQUESTED','RESCHEDULED') THEN
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND NEW.availability_id IS NOT DISTINCT FROM OLD.availability_id
    AND NEW.target_availability_id IS NOT DISTINCT FROM OLD.target_availability_id
    AND NEW.duration_minutes IS NOT DISTINCT FROM OLD.duration_minutes
    AND NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.is_deleted IS NOT DISTINCT FROM OLD.is_deleted THEN
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE'
    AND OLD.status='RESCHEDULE_REQUESTED'
    AND NEW.status=COALESCE(OLD.reschedule_previous_status,'CONFIRMED')
    AND NEW.target_availability_id IS NULL
    AND NEW.reschedule_previous_status IS NULL
    AND NEW.lock_expires_at IS NULL
    AND (to_jsonb(NEW)-ARRAY[
      'status','target_availability_id','reschedule_previous_status','lock_expires_at','updated_at'
    ])=(to_jsonb(OLD)-ARRAY[
      'status','target_availability_id','reschedule_previous_status','lock_expires_at','updated_at'
    ])
    AND EXISTS (
      SELECT 1 FROM _availabilities original_slot
      WHERE original_slot.id=OLD.availability_id
        AND original_slot.provider_id=OLD.provider_id
        AND original_slot.is_deleted=true
    ) THEN
    RETURN NEW;
  END IF;
  SELECT time_zone INTO v_time_zone FROM _provider_availability_settings WHERE provider_id=NEW.provider_id;
  IF v_time_zone IS NULL THEN v_time_zone := 'Asia/Kolkata'; END IF;
  SELECT COALESCE(NEW.duration_minutes,s.duration_minutes) INTO v_duration
    FROM _services s WHERE s.id=NEW.service_id AND s.provider_id=NEW.provider_id;
  IF v_duration IS NULL OR v_duration <= 0 THEN RAISE EXCEPTION 'Booking duration is invalid'; END IF;

  FOREACH v_slot_id IN ARRAY ARRAY[NEW.availability_id, NEW.target_availability_id] LOOP
    IF v_slot_id IS NULL THEN CONTINUE; END IF;
    SELECT start_time INTO v_start FROM _availabilities
      WHERE id=v_slot_id AND provider_id=NEW.provider_id AND is_deleted=false;
    IF v_start IS NULL THEN RAISE EXCEPTION 'Booking availability is invalid'; END IF;
    v_local_start := v_start AT TIME ZONE v_time_zone;
    v_local_end := (v_start + v_duration * INTERVAL '1 minute') AT TIME ZONE v_time_zone;
    IF v_local_start::DATE <> v_local_end::DATE
      OR v_local_start::TIME < TIME '10:00'
      OR v_local_end::TIME > TIME '18:00' THEN
      RAISE EXCEPTION 'Booking must fit between 10:00 AM and 6:00 PM provider-local time';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_booking_public_hours ON _bookings;
CREATE TRIGGER trg_enforce_booking_public_hours
BEFORE INSERT OR UPDATE ON _bookings
FOR EACH ROW EXECUTE FUNCTION enforce_booking_public_hours();

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
    AND (a.start_time AT TIME ZONE v_settings.time_zone)::TIME >= GREATEST(v_settings.opens_at,TIME '10:00')
    AND (a.end_time AT TIME ZONE v_settings.time_zone)::DATE=(a.start_time AT TIME ZONE v_settings.time_zone)::DATE
    AND (a.end_time AT TIME ZONE v_settings.time_zone)::TIME <= LEAST(v_settings.closes_at,TIME '18:00')
    AND NOT EXISTS(SELECT 1 FROM _provider_day_blocks d WHERE d.provider_id=p_provider_id
      AND d.blocked_date=(a.start_time AT TIME ZONE v_settings.time_zone)::DATE)
  ORDER BY a.start_time;
END;
$$;

REVOKE EXECUTE ON FUNCTION enforce_booking_public_hours() FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION get_provider_availabilities(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION get_provider_availabilities(UUID) TO service_role;
NOTIFY pgrst,'reload schema';
CREATE OR REPLACE FUNCTION enforce_extension_public_hours() RETURNS TRIGGER AS $$
DECLARE
  v_booking _bookings%ROWTYPE;
  v_time_zone TEXT;
  v_start TIMESTAMPTZ;
  v_local_start TIMESTAMP;
  v_local_end TIMESTAMP;
BEGIN
  IF NEW.status <> 'PENDING' THEN RETURN NEW; END IF;
  SELECT * INTO v_booking FROM _bookings WHERE id=NEW.booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found for extension'; END IF;
  SELECT time_zone INTO v_time_zone FROM _provider_availability_settings WHERE provider_id=v_booking.provider_id;
  SELECT start_time INTO v_start FROM _availabilities WHERE id=v_booking.availability_id;
  IF v_time_zone IS NULL THEN v_time_zone := 'Asia/Kolkata'; END IF;
  IF v_start IS NULL THEN RAISE EXCEPTION 'Booking availability is invalid'; END IF;
  v_local_start := v_start AT TIME ZONE v_time_zone;
  v_local_end := (v_start + (COALESCE(v_booking.duration_minutes,0) + NEW.additional_minutes) * INTERVAL '1 minute') AT TIME ZONE v_time_zone;
  IF v_local_start::DATE <> v_local_end::DATE OR v_local_start::TIME < TIME '10:00' OR v_local_end::TIME > TIME '18:00' THEN
    RAISE EXCEPTION 'Extended session must finish by 6:00 PM provider-local time';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_extension_public_hours ON _booking_extensions;
CREATE TRIGGER trg_enforce_extension_public_hours
BEFORE INSERT OR UPDATE ON _booking_extensions
FOR EACH ROW EXECUTE FUNCTION enforce_extension_public_hours();
REVOKE EXECUTE ON FUNCTION enforce_extension_public_hours() FROM PUBLIC,anon,authenticated;

COMMIT;




