-- Adds persistent provider defaults, a rolling materialized 30-day window,
-- and atomic provider day closures. Existing availability rows are preserved:
-- a date with any existing row is treated as an explicitly configured day.
BEGIN;

ALTER TABLE _bookings ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

CREATE TABLE IF NOT EXISTS _provider_availability_settings (
  provider_id UUID PRIMARY KEY REFERENCES _users(id) ON DELETE RESTRICT,
  time_zone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  opens_at TIME NOT NULL DEFAULT TIME '10:00',
  closes_at TIME NOT NULL DEFAULT TIME '18:00',
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_provider_working_hours CHECK (opens_at < closes_at)
);
ALTER TABLE _provider_availability_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO _provider_availability_settings(provider_id)
SELECT p.user_id FROM _provider_profiles p
JOIN _users u ON u.id = p.user_id AND u.role = 'PROVIDER' AND u.is_deleted = false
WHERE p.is_deleted = false
ON CONFLICT (provider_id) DO NOTHING;

CREATE OR REPLACE FUNCTION create_provider_availability_defaults()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO _provider_availability_settings(provider_id)
  VALUES (NEW.user_id) ON CONFLICT (provider_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_provider_availability_defaults ON _provider_profiles;
CREATE TRIGGER trg_provider_availability_defaults
AFTER INSERT ON _provider_profiles
FOR EACH ROW EXECUTE FUNCTION create_provider_availability_defaults();

CREATE TABLE IF NOT EXISTS _provider_day_blocks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id UUID NOT NULL REFERENCES _users(id) ON DELETE RESTRICT,
  blocked_date DATE NOT NULL,
  reason TEXT NOT NULL DEFAULT 'PROVIDER_DAY_CLOSURE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider_id, blocked_date)
);
ALTER TABLE _provider_day_blocks ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_provider_day_blocks_date ON _provider_day_blocks(provider_id, blocked_date);

CREATE OR REPLACE FUNCTION ensure_provider_availability_window(p_provider_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_settings _provider_availability_settings%ROWTYPE;
  v_today DATE;
  v_date DATE;
  v_local_start TIMESTAMP;
  v_local_end TIMESTAMP;
  v_created INTEGER := 0;
  v_day_created INTEGER;
BEGIN
  SELECT * INTO v_settings FROM _provider_availability_settings
  WHERE provider_id = p_provider_id AND is_enabled = true;
  IF NOT FOUND THEN RETURN 0; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM _users u JOIN _provider_profiles p ON p.user_id=u.id
    WHERE u.id=p_provider_id AND u.role='PROVIDER' AND u.is_deleted=false AND p.is_deleted=false
  ) OR NOT EXISTS (
    SELECT 1 FROM _services s WHERE s.provider_id=p_provider_id AND s.is_deleted=false AND s.approval_status='APPROVED'
  ) THEN RETURN 0; END IF;

  v_today := (NOW() AT TIME ZONE v_settings.time_zone)::DATE;
  FOR v_date IN SELECT v_today + day_offset FROM generate_series(1, 32) AS days(day_offset) LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(p_provider_id::TEXT || ':' || v_date::TEXT, 0));
    IF EXISTS (SELECT 1 FROM _provider_day_blocks b WHERE b.provider_id=p_provider_id AND b.blocked_date=v_date) THEN
      CONTINUE;
    END IF;
    -- Any stored rows on a date denote provider-configured hours/breaks. Do not fill gaps.
    IF EXISTS (SELECT 1 FROM _availabilities a WHERE a.provider_id=p_provider_id AND a.is_deleted=false
      AND (a.start_time AT TIME ZONE v_settings.time_zone)::DATE=v_date) THEN
      CONTINUE;
    END IF;

    v_local_start := v_date + v_settings.opens_at;
    v_local_end := v_date + v_settings.closes_at;
    BEGIN
      INSERT INTO _availabilities(provider_id,start_time,end_time,is_booked,is_deleted)
      SELECT p_provider_id, (v_local_start + (step * INTERVAL '15 minutes')) AT TIME ZONE v_settings.time_zone,
        (v_local_start + ((step + 1) * INTERVAL '15 minutes')) AT TIME ZONE v_settings.time_zone,
        false,false
      FROM generate_series(0, FLOOR(EXTRACT(EPOCH FROM (v_local_end-v_local_start))/900)::INTEGER-1) AS offsets(step);
      GET DIAGNOSTICS v_day_created = ROW_COUNT;
      v_created := v_created + v_day_created;
    EXCEPTION WHEN exclusion_violation THEN
      -- A manual schedule won a race. Roll back that day's generated rows only.
      NULL;
    END;
  END LOOP;
  RETURN v_created;
END;
$$ LANGUAGE plpgsql;

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
    IF v_slot.id=v_horizon_slot AND v_date <= (NOW() AT TIME ZONE v_settings.time_zone)::DATE THEN
      RAISE EXCEPTION 'Bookings must be scheduled for a future date';
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
DROP TRIGGER IF EXISTS trg_prevent_booking_on_closed_day ON _bookings;
CREATE TRIGGER trg_prevent_booking_on_closed_day
BEFORE INSERT OR UPDATE ON _bookings
FOR EACH ROW EXECUTE FUNCTION prevent_booking_on_closed_day();

CREATE OR REPLACE FUNCTION block_provider_day(p_provider_id UUID,p_date DATE)
RETURNS JSONB AS $$
DECLARE
  v_settings _provider_availability_settings%ROWTYPE;
  v_booking RECORD;
  v_slots UUID[];
  v_count INTEGER := 0;
BEGIN
  IF p_date <= (NOW() AT TIME ZONE COALESCE((SELECT time_zone FROM _provider_availability_settings WHERE provider_id=p_provider_id),'Asia/Kolkata'))::DATE THEN
    RAISE EXCEPTION 'Only a future date can be blocked';
  END IF;
  SELECT * INTO v_settings FROM _provider_availability_settings WHERE provider_id=p_provider_id AND is_enabled=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider availability is not configured'; END IF;
  IF NOT EXISTS (SELECT 1 FROM _users u JOIN _provider_profiles p ON p.user_id=u.id
    WHERE u.id=p_provider_id AND u.role='PROVIDER' AND u.is_deleted=false AND p.is_deleted=false) THEN
    RAISE EXCEPTION 'Provider is unavailable';
  END IF;
  PERFORM expire_booking_holds();
  PERFORM pg_advisory_xact_lock(hashtextextended(p_provider_id::TEXT || ':' || p_date::TEXT, 0));
  INSERT INTO _provider_day_blocks(provider_id,blocked_date)
  VALUES(p_provider_id,p_date) ON CONFLICT(provider_id,blocked_date) DO NOTHING;

  FOR v_booking IN
    SELECT b.id,b.customer_id,b.availability_id,b.duration_minutes,b.status,b.reschedule_previous_status,
      s.title AS service_title,a.start_time,
      (a.start_time AT TIME ZONE v_settings.time_zone)::DATE AS booking_date
    FROM _bookings b JOIN _services s ON s.id=b.service_id
    JOIN _availabilities a ON a.id=b.availability_id
    LEFT JOIN _availabilities target ON target.id=b.target_availability_id
    WHERE b.provider_id=p_provider_id AND b.is_deleted=false
      AND b.status IN ('PENDING','CONFIRMED','RESCHEDULE_REQUESTED','RESCHEDULED')
      AND (b.lock_expires_at IS NULL OR b.lock_expires_at>NOW())
      AND ((a.start_time AT TIME ZONE v_settings.time_zone)::DATE=p_date
        OR (b.status='RESCHEDULE_REQUESTED' AND target.id IS NOT NULL
          AND (target.start_time AT TIME ZONE v_settings.time_zone)::DATE=p_date))
      AND a.start_time>NOW()
    FOR UPDATE OF b NOWAIT
  LOOP
    IF v_booking.booking_date<>p_date THEN
      UPDATE _bookings SET target_availability_id=NULL,
        status=COALESCE(v_booking.reschedule_previous_status,'CONFIRMED'),
        reschedule_previous_status=NULL,lock_expires_at=NULL,updated_at=NOW()
        WHERE id=v_booking.id;
      PERFORM emit_booking_notification(v_booking.customer_id,'RESCHEDULE_REJECTED',
        'Your reschedule request was declined because the provider closed on '||p_date::TEXT||'.',
        jsonb_build_object('booking_id',v_booking.id,'date',p_date,
          'request_kind','RESCHEDULE','result','REJECTED','reason','PROVIDER_DAY_CLOSURE'));
      CONTINUE;
    END IF;
    SELECT array_agg(slot_id) INTO v_slots FROM _booking_extensions e
      CROSS JOIN LATERAL unnest(e.slot_ids) slot_id
      WHERE e.booking_id=v_booking.id AND e.status='PENDING';
    PERFORM release_unclaimed_availability_slots(
      (SELECT array_agg(id) FROM _availabilities WHERE provider_id=p_provider_id
       AND start_time>=v_booking.start_time AND start_time<v_booking.start_time+v_booking.duration_minutes*INTERVAL '1 minute'
       AND is_deleted=false),v_booking.id,NULL);
    UPDATE _booking_extensions SET status='CANCELLED',reviewed_at=NOW()
      WHERE booking_id=v_booking.id AND status='PENDING';
    PERFORM release_unclaimed_availability_slots(v_slots,v_booking.id,NULL);
    UPDATE _bookings SET status='CANCELLED',cancellation_reason='PROVIDER_DAY_CLOSURE',target_availability_id=NULL,
      reschedule_previous_status=NULL,lock_expires_at=NULL,updated_at=NOW()
      WHERE id=v_booking.id;
    PERFORM emit_booking_notification(v_booking.customer_id,'BOOKING_CANCELLED',
      'Your '||v_booking.service_title||' booking on '||p_date::TEXT||' was cancelled because the provider closed for that day.',
      jsonb_build_object('booking_id',v_booking.id,'service_title',v_booking.service_title,
        'date',p_date,'request_kind','PROVIDER_DAY_CLOSURE','result','CANCELLED'));
    v_count:=v_count+1;
  END LOOP;
  RETURN jsonb_build_object('blocked',true,'date',p_date,'cancelled_bookings',v_count);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION unblock_provider_day(p_provider_id UUID,p_date DATE)
RETURNS BOOLEAN AS $$
DECLARE v_tz TEXT;
BEGIN
  SELECT time_zone INTO v_tz FROM _provider_availability_settings WHERE provider_id=p_provider_id;
  IF v_tz IS NULL THEN RAISE EXCEPTION 'Provider availability is not configured'; END IF;
  IF NOT EXISTS (SELECT 1 FROM _users u JOIN _provider_profiles p ON p.user_id=u.id
    WHERE u.id=p_provider_id AND u.role='PROVIDER' AND u.is_deleted=false AND p.is_deleted=false) THEN
    RAISE EXCEPTION 'Provider is unavailable';
  END IF;
  IF p_date <= (NOW() AT TIME ZONE v_tz)::DATE THEN RAISE EXCEPTION 'Only a future date can be reopened'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_provider_id::TEXT || ':' || p_date::TEXT, 0));
  DELETE FROM _provider_day_blocks WHERE provider_id=p_provider_id AND blocked_date=p_date;
  RETURN FOUND;
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
    AND (a.start_time AT TIME ZONE v_settings.time_zone)::DATE >= v_today+1
    AND (a.start_time AT TIME ZONE v_settings.time_zone)::TIME>=v_settings.opens_at
    AND (a.end_time AT TIME ZONE v_settings.time_zone)::DATE=(a.start_time AT TIME ZONE v_settings.time_zone)::DATE
    AND (a.end_time AT TIME ZONE v_settings.time_zone)::TIME<=v_settings.closes_at
    AND NOT EXISTS(SELECT 1 FROM _provider_day_blocks d WHERE d.provider_id=p_provider_id
      AND d.blocked_date=(a.start_time AT TIME ZONE v_settings.time_zone)::DATE)
  ORDER BY a.start_time;
END;
$$;

REVOKE EXECUTE ON FUNCTION ensure_provider_availability_window(UUID) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION block_provider_day(UUID,DATE) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION unblock_provider_day(UUID,DATE) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION ensure_provider_availability_window(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION block_provider_day(UUID,DATE) TO service_role;
GRANT EXECUTE ON FUNCTION unblock_provider_day(UUID,DATE) TO service_role;
REVOKE EXECUTE ON FUNCTION get_provider_availabilities(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION get_provider_availabilities(UUID) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
