BEGIN;

CREATE OR REPLACE FUNCTION respond_to_booking_request(
  p_booking_id UUID,
  p_provider_id UUID,
  p_approve BOOLEAN
) RETURNS SETOF _bookings AS $$
DECLARE
  b _bookings%ROWTYPE;
  v_start TIMESTAMPTZ;
  v_duration INTEGER;
  v_slots UUID[];
  v_extension_slots UUID[];
  v_slot_count INTEGER;
  v_valid_chain BOOLEAN;
BEGIN
  IF p_approve IS NULL THEN RAISE EXCEPTION 'Action must be approve or reject'; END IF;
  PERFORM expire_booking_holds();

  SELECT * INTO b FROM _bookings
  WHERE id=p_booking_id
    AND provider_id=p_provider_id
    AND status='PENDING'
    AND is_deleted=false
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF EXISTS (
    SELECT 1 FROM _booking_cancellation_requests
    WHERE booking_id=b.id AND status='PENDING'
  ) THEN
    RAISE EXCEPTION 'Resolve the pending cancellation request before responding to this booking';
  END IF;

  SELECT a.start_time,COALESCE(b.duration_minutes,s.duration_minutes)
  INTO v_start,v_duration
  FROM _availabilities a
  JOIN _services s ON s.id=b.service_id
  WHERE a.id=b.availability_id AND a.provider_id=b.provider_id;
  IF v_start IS NULL THEN RAISE EXCEPTION 'Booking availability is missing'; END IF;
  IF v_duration IS NULL OR v_duration<=0 OR v_duration%15<>0 THEN
    RAISE EXCEPTION 'Booking duration is invalid';
  END IF;

  IF p_approve THEN
    PERFORM a.id FROM _availabilities a
    WHERE a.provider_id=b.provider_id
      AND a.start_time>=v_start
      AND a.start_time<v_start+v_duration*INTERVAL '1 minute'
      AND a.is_deleted=false
    ORDER BY a.start_time
    FOR UPDATE NOWAIT;

    SELECT array_agg(id ORDER BY start_time),COUNT(*)::INTEGER,
      COALESCE(BOOL_AND(is_booked AND NOT is_deleted
        AND start_time=v_start+((rn-1)*INTERVAL '15 minutes')
        AND end_time=start_time+INTERVAL '15 minutes'),false)
    INTO v_slots,v_slot_count,v_valid_chain
    FROM (
      SELECT id,start_time,end_time,is_booked,is_deleted,
        ROW_NUMBER() OVER (ORDER BY start_time) rn
      FROM _availabilities
      WHERE provider_id=b.provider_id
        AND start_time>=v_start
        AND start_time<v_start+v_duration*INTERVAL '1 minute'
        AND is_deleted=false
    ) reserved_slots;

    IF v_slot_count<>v_duration/15 OR NOT v_valid_chain
      OR v_slots[1] IS DISTINCT FROM b.availability_id THEN
      RAISE EXCEPTION 'Booking slots are no longer available';
    END IF;

    UPDATE _bookings SET status='CONFIRMED',updated_at=NOW()
    WHERE id=b.id;
    PERFORM emit_booking_notification(b.customer_id,'BOOKING_CONFIRMED',
      'Your provider confirmed your booking.',
      jsonb_build_object('booking_id',b.id,'request_kind','BOOKING','result','APPROVED'));
  ELSE
    PERFORM a.id FROM _availabilities a
    WHERE a.provider_id=b.provider_id
      AND a.start_time>=v_start
      AND a.start_time<v_start+v_duration*INTERVAL '1 minute'
    ORDER BY a.start_time
    FOR UPDATE;

    SELECT array_agg(id ORDER BY start_time) INTO v_slots
    FROM _availabilities
    WHERE provider_id=b.provider_id
      AND start_time>=v_start
      AND start_time<v_start+v_duration*INTERVAL '1 minute';

    SELECT array_agg(DISTINCT held.slot_id) INTO v_extension_slots
    FROM _booking_extensions e
    CROSS JOIN LATERAL UNNEST(e.slot_ids) AS held(slot_id)
    WHERE e.booking_id=b.id AND e.status='PENDING';

    UPDATE _booking_extensions SET status='CANCELLED',reviewed_at=NOW()
    WHERE booking_id=b.id AND status='PENDING';
    UPDATE _bookings SET status='CANCELLED',updated_at=NOW()
    WHERE id=b.id;

    PERFORM release_unclaimed_availability_slots(v_slots,b.id,NULL);
    PERFORM release_unclaimed_availability_slots(v_extension_slots,b.id,NULL);
    PERFORM emit_booking_notification(b.customer_id,'BOOKING_CANCELLED',
      'Your provider could not accept this booking request.',
      jsonb_build_object('booking_id',b.id,'request_kind','BOOKING','result','REJECTED'));
  END IF;

  RETURN QUERY SELECT * FROM _bookings WHERE id=b.id;
EXCEPTION WHEN lock_not_available THEN
  RAISE EXCEPTION 'Booking slots are being updated; retry the request';
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION respond_to_booking_request(UUID,UUID,BOOLEAN) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION respond_to_booking_request(UUID,UUID,BOOLEAN) TO service_role;
NOTIFY pgrst,'reload schema';

COMMIT;
