-- Prevent bookings from bypassing active booking, reschedule, or extension holds.
BEGIN;

CREATE OR REPLACE FUNCTION create_booking_with_slots(
    p_customer_id UUID,
    p_provider_id UUID,
    p_service_id UUID,
    p_start_time TIMESTAMPTZ,
    p_availability_id UUID,
    p_final_status TEXT,
    p_payment_amount NUMERIC,
    p_payment_status TEXT,
    p_payment_method TEXT,
    p_transaction_id TEXT
) RETURNS JSONB AS $$
DECLARE
  v_start TIMESTAMPTZ;
  v_duration INTEGER;
  v_slot_count INTEGER;
  v_slots UUID[];
  v_has_booked BOOLEAN;
  v_valid_chain BOOLEAN;
  v_booking_id UUID;
  v_service_title TEXT;
BEGIN
  PERFORM expire_booking_holds();
  IF p_final_status NOT IN ('PENDING', 'CONFIRMED') THEN RAISE EXCEPTION 'Invalid booking status'; END IF;

  IF p_start_time IS NULL AND p_availability_id IS NOT NULL THEN
    SELECT start_time INTO v_start FROM _availabilities
    WHERE id = p_availability_id AND provider_id = p_provider_id AND is_deleted = false;
  ELSE
    v_start := p_start_time;
  END IF;
  IF v_start IS NULL OR v_start < NOW() OR v_start > NOW() + INTERVAL '2 months' THEN
    RAISE EXCEPTION 'Booking time must be within the next 2 months';
  END IF;

  SELECT duration_minutes, title INTO v_duration, v_service_title
  FROM _services WHERE id = p_service_id AND provider_id = p_provider_id
    AND is_deleted = false AND approval_status = 'APPROVED';
  IF v_duration IS NULL THEN RAISE EXCEPTION 'Approved service not found for provider'; END IF;
  IF v_duration <= 0 OR v_duration % 15 <> 0 THEN RAISE EXCEPTION 'Service duration must be a positive multiple of 15'; END IF;

  PERFORM id FROM _availabilities
  WHERE provider_id = p_provider_id
    AND start_time >= v_start AND start_time < v_start + v_duration * INTERVAL '1 minute'
    AND is_deleted = false
  ORDER BY start_time FOR UPDATE;

  SELECT array_agg(id ORDER BY start_time), COUNT(*)::INTEGER,
         COALESCE(BOOL_OR(is_booked), false),
         COALESCE(BOOL_AND(start_time = v_start + ((rn - 1) * INTERVAL '15 minutes')
           AND end_time = start_time + INTERVAL '15 minutes'), false)
  INTO v_slots, v_slot_count, v_has_booked, v_valid_chain
  FROM (
    SELECT id, start_time, end_time, is_booked, ROW_NUMBER() OVER (ORDER BY start_time) rn
    FROM _availabilities WHERE provider_id = p_provider_id
      AND start_time >= v_start AND start_time < v_start + v_duration * INTERVAL '1 minute'
      AND is_deleted = false
  ) slots;

  IF v_slot_count <> v_duration / 15 OR NOT v_valid_chain OR v_has_booked THEN
    RAISE EXCEPTION 'No consecutive slots available';
  END IF;
  IF p_availability_id IS NOT NULL AND v_slots[1] <> p_availability_id THEN
    RAISE EXCEPTION 'Selected availability does not match requested start time';
  END IF;
  -- Reserve against complete active intervals, including reschedule targets whose
  -- continuation rows may not have is_booked set.
  IF EXISTS (
    SELECT 1
    FROM _bookings b
    JOIN _services s ON s.id = b.service_id
    JOIN _availabilities booked_start ON booked_start.id = b.availability_id
    LEFT JOIN _availabilities target_start ON target_start.id = b.target_availability_id
    WHERE b.provider_id = p_provider_id AND b.is_deleted = false
      AND b.status IN ('PENDING','CONFIRMED','RESCHEDULE_REQUESTED','RESCHEDULED')
      AND (b.lock_expires_at IS NULL OR b.lock_expires_at > NOW())
      AND (
        (v_start < booked_start.start_time + COALESCE(b.duration_minutes,s.duration_minutes) * INTERVAL '1 minute'
          AND v_start + v_duration * INTERVAL '1 minute' > booked_start.start_time)
        OR (b.status = 'RESCHEDULE_REQUESTED' AND target_start.id IS NOT NULL
          AND v_start < target_start.start_time + COALESCE(b.duration_minutes,s.duration_minutes) * INTERVAL '1 minute'
          AND v_start + v_duration * INTERVAL '1 minute' > target_start.start_time)
      )
  ) OR EXISTS (
    SELECT 1 FROM _booking_extensions e
    WHERE e.status = 'PENDING' AND e.expires_at > NOW() AND e.slot_ids && v_slots
  ) THEN
    RAISE EXCEPTION 'No consecutive slots available';
  END IF;

  INSERT INTO _bookings (customer_id, provider_id, service_id, availability_id, status, duration_minutes)
  VALUES (p_customer_id, p_provider_id, p_service_id, v_slots[1], p_final_status::booking_status, v_duration)
  RETURNING id INTO v_booking_id;
  UPDATE _availabilities SET is_booked = true WHERE id = ANY(v_slots);

  IF p_payment_status IS NOT NULL THEN
    INSERT INTO _payments (booking_id, amount, status, payment_method, transaction_id)
    VALUES (v_booking_id, p_payment_amount, p_payment_status::payment_status, p_payment_method, p_transaction_id);
  END IF;

  PERFORM emit_booking_notification(p_provider_id, 'BOOKING_CONFIRMED',
    'A customer booked ' || v_service_title || '.',
    jsonb_build_object('booking_id', v_booking_id, 'request_kind', 'BOOKING'));
  RETURN jsonb_build_object('booking_id', v_booking_id, 'slots_used', v_slot_count, 'start_time', v_start);
END;
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';
COMMIT;

