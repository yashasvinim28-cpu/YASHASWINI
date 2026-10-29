-- Preserve prior booking status and safely validate/transfer complete slot chains on reschedule.
ALTER TABLE _bookings ADD COLUMN IF NOT EXISTS reschedule_previous_status booking_status;
CREATE OR REPLACE FUNCTION request_safe_reschedule(
    p_booking_id UUID,
    p_target_availability_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_booking RECORD;
    v_target_start TIMESTAMPTZ;
    v_slot_ids UUID[];
    v_slot_count INTEGER;
    v_any_booked BOOLEAN;
    v_valid_chain BOOLEAN;
BEGIN
    SELECT b.provider_id, b.availability_id, b.status,
           s.duration_minutes, current_slot.start_time AS current_start
    INTO v_booking
    FROM _bookings b
    JOIN _services s ON s.id = b.service_id
    JOIN _availabilities current_slot ON current_slot.id = b.availability_id
    WHERE b.id = p_booking_id
      AND b.is_deleted = false
      AND b.status IN ('PENDING', 'CONFIRMED', 'RESCHEDULED')
    FOR UPDATE OF b;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    IF v_booking.current_start <= NOW() OR v_booking.duration_minutes <= 0
       OR v_booking.duration_minutes % 15 <> 0 THEN
        RETURN FALSE;
    END IF;

    SELECT start_time INTO v_target_start
    FROM _availabilities
    WHERE id = p_target_availability_id
      AND provider_id = v_booking.provider_id
      AND is_deleted = false
    FOR UPDATE NOWAIT;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    IF v_target_start <= NOW() OR v_target_start > NOW() + INTERVAL '2 months'
       OR p_target_availability_id = v_booking.availability_id
       OR (v_target_start < v_booking.current_start + v_booking.duration_minutes * INTERVAL '1 minute'
           AND v_target_start + v_booking.duration_minutes * INTERVAL '1 minute' > v_booking.current_start) THEN
        RETURN FALSE;
    END IF;

    -- Lock the complete 15-minute chain so a concurrent booking cannot take part of it.
    PERFORM id
    FROM _availabilities
    WHERE provider_id = v_booking.provider_id
      AND start_time >= v_target_start
      AND start_time < v_target_start + v_booking.duration_minutes * INTERVAL '1 minute'
      AND is_deleted = false
    ORDER BY start_time
    FOR UPDATE NOWAIT;

    SELECT array_agg(id ORDER BY start_time), COUNT(*)::INTEGER,
           COALESCE(BOOL_OR(is_booked), true),
           COALESCE(BOOL_AND(
             start_time = v_target_start + ((rn - 1) * INTERVAL '15 minutes')
             AND end_time = start_time + INTERVAL '15 minutes'
           ), false)
    INTO v_slot_ids, v_slot_count, v_any_booked, v_valid_chain
    FROM (
      SELECT id, start_time, end_time, is_booked,
             ROW_NUMBER() OVER (ORDER BY start_time) AS rn
      FROM _availabilities
      WHERE provider_id = v_booking.provider_id
        AND start_time >= v_target_start
        AND start_time < v_target_start + v_booking.duration_minutes * INTERVAL '1 minute'
        AND is_deleted = false
    ) slots;

    IF v_slot_count <> v_booking.duration_minutes / 15
       OR NOT v_valid_chain OR v_any_booked
       OR v_slot_ids[1] <> p_target_availability_id THEN
        RETURN FALSE;
    END IF;

    IF EXISTS (
        SELECT 1 FROM _bookings b
        WHERE b.id <> p_booking_id
          AND (b.availability_id = ANY(v_slot_ids) OR b.target_availability_id = ANY(v_slot_ids))
          AND b.status IN ('PENDING', 'CONFIRMED', 'RESCHEDULE_REQUESTED', 'RESCHEDULED')
          AND b.is_deleted = false
          AND (b.lock_expires_at IS NULL OR b.lock_expires_at > NOW())
    ) THEN
        RETURN FALSE;
    END IF;

    UPDATE _bookings
    SET target_availability_id = p_target_availability_id, 
        status = 'RESCHEDULE_REQUESTED',
        reschedule_previous_status = v_booking.status,
        lock_expires_at = NOW() + INTERVAL '24 hours',
        updated_at = NOW()
    WHERE id = p_booking_id
      AND status = v_booking.status
      AND target_availability_id IS NULL;

    RETURN FOUND;

EXCEPTION
    WHEN lock_not_available THEN
        RETURN FALSE;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION approve_safe_reschedule(p_booking_id UUID, p_provider_id UUID)
RETURNS SETOF _bookings AS $$
DECLARE
    v_booking _bookings%ROWTYPE;
    v_duration INTEGER;
    v_old_start TIMESTAMPTZ;
    v_target_start TIMESTAMPTZ;
    v_slot_ids UUID[];
    v_slot_count INTEGER;
    v_any_booked BOOLEAN;
    v_valid_chain BOOLEAN;
BEGIN
    SELECT * INTO v_booking
    FROM _bookings
    WHERE id = p_booking_id
      AND provider_id = p_provider_id
      AND status = 'RESCHEDULE_REQUESTED'
      AND (lock_expires_at IS NULL OR lock_expires_at > NOW())
    FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT s.duration_minutes, old_slot.start_time, target_slot.start_time
    INTO v_duration, v_old_start, v_target_start
    FROM _services s
    JOIN _availabilities old_slot ON old_slot.id = v_booking.availability_id
    JOIN _availabilities target_slot ON target_slot.id = v_booking.target_availability_id
    WHERE s.id = v_booking.service_id
      AND target_slot.provider_id = p_provider_id
      AND target_slot.is_deleted = false;
    IF NOT FOUND THEN RETURN; END IF;
    IF v_duration <= 0 OR v_duration % 15 <> 0 OR v_target_start <= NOW()
       OR v_target_start > NOW() + INTERVAL '2 months'
       OR (v_target_start < v_old_start + v_duration * INTERVAL '1 minute'
           AND v_target_start + v_duration * INTERVAL '1 minute' > v_old_start) THEN
        RETURN;
    END IF;

    PERFORM id
    FROM _availabilities
    WHERE provider_id = p_provider_id
      AND start_time >= v_target_start
      AND start_time < v_target_start + v_duration * INTERVAL '1 minute'
      AND is_deleted = false
    ORDER BY start_time
    FOR UPDATE NOWAIT;

    SELECT array_agg(id ORDER BY start_time), COUNT(*)::INTEGER,
           COALESCE(BOOL_OR(is_booked), true),
           COALESCE(BOOL_AND(
             start_time = v_target_start + ((rn - 1) * INTERVAL '15 minutes')
             AND end_time = start_time + INTERVAL '15 minutes'
           ), false)
    INTO v_slot_ids, v_slot_count, v_any_booked, v_valid_chain
    FROM (
      SELECT id, start_time, end_time, is_booked,
             ROW_NUMBER() OVER (ORDER BY start_time) AS rn
      FROM _availabilities
      WHERE provider_id = p_provider_id
        AND start_time >= v_target_start
        AND start_time < v_target_start + v_duration * INTERVAL '1 minute'
        AND is_deleted = false
    ) slots;

    IF v_slot_count <> v_duration / 15 OR NOT v_valid_chain OR v_any_booked
       OR v_slot_ids[1] <> v_booking.target_availability_id
       OR EXISTS (
         SELECT 1 FROM _bookings other_booking
         WHERE other_booking.id <> p_booking_id
           AND other_booking.is_deleted = false
           AND other_booking.status IN ('PENDING', 'CONFIRMED', 'RESCHEDULE_REQUESTED', 'RESCHEDULED')
           AND (other_booking.lock_expires_at IS NULL OR other_booking.lock_expires_at > NOW())
           AND (other_booking.availability_id = ANY(v_slot_ids)
                OR other_booking.target_availability_id = ANY(v_slot_ids))
       ) THEN
        RETURN;
    END IF;

    UPDATE _availabilities
    SET is_booked = false
    WHERE provider_id = p_provider_id
      AND start_time >= v_old_start
      AND start_time < v_old_start + v_duration * INTERVAL '1 minute'
      AND is_deleted = false;

    UPDATE _availabilities
    SET is_booked = true
    WHERE id = ANY(v_slot_ids);

    UPDATE _bookings
    SET availability_id = v_booking.target_availability_id,
        target_availability_id = NULL,
        status = 'RESCHEDULED',
        reschedule_previous_status = NULL,
        lock_expires_at = NULL,
        updated_at = NOW()
    WHERE id = p_booking_id;
    RETURN QUERY SELECT * FROM _bookings WHERE id = p_booking_id;
EXCEPTION
    WHEN lock_not_available THEN
        RETURN;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION reject_safe_reschedule(p_booking_id UUID, p_provider_id UUID)
RETURNS SETOF _bookings AS $$
BEGIN
    RETURN QUERY
    UPDATE _bookings
    SET target_availability_id = NULL,
        status = COALESCE(reschedule_previous_status, 'CONFIRMED'),
        reschedule_previous_status = NULL,
        lock_expires_at = NULL,
        updated_at = NOW()
    WHERE id = p_booking_id
      AND provider_id = p_provider_id
      AND status = 'RESCHEDULE_REQUESTED'
    RETURNING *;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION request_safe_reschedule(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION approve_safe_reschedule(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION reject_safe_reschedule(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION request_safe_reschedule(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION approve_safe_reschedule(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION reject_safe_reschedule(UUID, UUID) TO service_role;
NOTIFY pgrst, 'reload schema';