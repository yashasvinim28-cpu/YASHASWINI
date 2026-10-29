-- Resolve cancellation requests that reach provider approval after their
-- booking has started instead of leaving them pending indefinitely.
BEGIN;

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
  IF v_start IS NULL OR v_start<=NOW() THEN
    UPDATE _booking_cancellation_requests SET status='REJECTED',reviewed_at=NOW() WHERE id=r.id;
    PERFORM emit_booking_notification(r.customer_id,'RESCHEDULE_REJECTED',
      'Your cancellation request could not be approved because the booking has already started.',
      jsonb_build_object('booking_id',b.id,'cancellation_request_id',r.id,
        'request_kind','CANCELLATION','result','REJECTED'));
    RETURN QUERY SELECT * FROM _booking_cancellation_requests WHERE id=r.id;
    RETURN;
  END IF;

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

NOTIFY pgrst,'reload schema';
COMMIT;
