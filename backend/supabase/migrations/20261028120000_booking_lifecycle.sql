-- Booking lifecycle support: duration snapshots, expiring extension holds,
-- transactional conflict checks, and in-app notification payloads.
-- Review and apply manually to hosted Supabase before deploying the API changes.

BEGIN;

ALTER TABLE _bookings
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS extension_amount_due NUMERIC(10,2) NOT NULL DEFAULT 0;

UPDATE _bookings b
SET duration_minutes = s.duration_minutes
FROM _services s
WHERE s.id = b.service_id
  AND b.duration_minutes IS NULL;

-- Do not invent a duration or discard an orphaned booking. If any booking
-- cannot be backfilled from its service, abort and let the owner resolve it.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM _bookings WHERE duration_minutes IS NULL) THEN
    RAISE EXCEPTION 'Cannot set booking duration: one or more bookings have no matching service duration.';
  END IF;
END $$;

ALTER TABLE _bookings
  ALTER COLUMN duration_minutes SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE _bookings ADD CONSTRAINT chk_booking_duration_minutes
    CHECK (duration_minutes > 0 AND duration_minutes % 15 = 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE _notifications
  ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::JSONB;

CREATE TABLE IF NOT EXISTS _booking_extensions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES _bookings(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL REFERENCES _users(id) ON DELETE RESTRICT,
  additional_minutes INTEGER NOT NULL CHECK (additional_minutes IN (15, 30, 60)),
  additional_price NUMERIC(10,2) NOT NULL CHECK (additional_price >= 0),
  slot_ids UUID[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED')),
  expires_at TIMESTAMPTZ NOT NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE _booking_extensions ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_pending_extension_per_booking
  ON _booking_extensions (booking_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_booking_extensions_booking_id
  ON _booking_extensions (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expiring_reschedule_holds
  ON _bookings (lock_expires_at) WHERE status = 'RESCHEDULE_REQUESTED' AND is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_expiring_extension_holds
  ON _booking_extensions (expires_at) WHERE status = 'PENDING';

CREATE OR REPLACE FUNCTION emit_booking_notification(
  p_user_id UUID,
  p_type notification_type,
  p_message TEXT,
  p_data JSONB
) RETURNS VOID AS $$
BEGIN
  INSERT INTO _notifications (user_id, type, message, data)
  VALUES (p_user_id, p_type, p_message, COALESCE(p_data, '{}'::JSONB));
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_refund_consistency() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'CANCELLED'
     AND OLD.status IN ('PENDING','CONFIRMED','RESCHEDULED','RESCHEDULE_REQUESTED') THEN
    UPDATE _payments SET status='REFUNDED',updated_at=NOW()
    WHERE booking_id=NEW.id AND status='SUCCESS' AND is_deleted=false;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- schema.sql already defines these triggers. Recreate them here so the
-- replacement functions are attached even if the migration is applied to a
-- compatible schema where either trigger is missing. Re-running is safe.
DROP TRIGGER IF EXISTS trg_enforce_refund ON _bookings;
CREATE TRIGGER trg_enforce_refund
AFTER UPDATE OF status ON _bookings
FOR EACH ROW
EXECUTE FUNCTION enforce_refund_consistency();

-- Clear a slot flag only when no other active booking, reschedule target, or
-- pending extension still owns that slot. Callers exclude the request being
-- released while retaining protection from all other reservations.
CREATE OR REPLACE FUNCTION release_unclaimed_availability_slots(
  p_slot_ids UUID[], p_exclude_booking_id UUID, p_exclude_extension_id UUID
) RETURNS VOID AS $$
BEGIN
  UPDATE _availabilities a SET is_booked = false
  WHERE a.id = ANY(p_slot_ids) AND a.is_deleted = false
    AND NOT EXISTS (
      SELECT 1 FROM _bookings b
      JOIN _services s ON s.id = b.service_id
      JOIN _availabilities base_slot ON base_slot.id = b.availability_id
      WHERE b.id <> COALESCE(p_exclude_booking_id, '00000000-0000-0000-0000-000000000000'::UUID)
        AND b.provider_id = a.provider_id AND b.is_deleted = false
        AND b.status IN ('PENDING','CONFIRMED','RESCHEDULE_REQUESTED','RESCHEDULED')
        AND (b.lock_expires_at IS NULL OR b.lock_expires_at > NOW())
        AND a.start_time < base_slot.start_time + COALESCE(b.duration_minutes,s.duration_minutes) * INTERVAL '1 minute'
        AND a.end_time > base_slot.start_time
    )
    AND NOT EXISTS (
      SELECT 1 FROM _bookings b
      JOIN _services s ON s.id = b.service_id
      JOIN _availabilities target_slot ON target_slot.id = b.target_availability_id
      WHERE b.id <> COALESCE(p_exclude_booking_id, '00000000-0000-0000-0000-000000000000'::UUID)
        AND b.provider_id = a.provider_id AND b.is_deleted = false
        AND b.status = 'RESCHEDULE_REQUESTED'
        AND (b.lock_expires_at IS NULL OR b.lock_expires_at > NOW())
        AND a.start_time < target_slot.start_time + COALESCE(b.duration_minutes,s.duration_minutes) * INTERVAL '1 minute'
        AND a.end_time > target_slot.start_time
    )
    AND NOT EXISTS (
      SELECT 1 FROM _booking_extensions e
      WHERE e.id <> COALESCE(p_exclude_extension_id, '00000000-0000-0000-0000-000000000000'::UUID)
        AND e.status = 'PENDING' AND e.expires_at > NOW() AND a.id = ANY(e.slot_ids)
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION expire_booking_holds()
RETURNS INTEGER AS $$
DECLARE
  v_booking RECORD;
  v_extension RECORD;
  v_expired INTEGER := 0;
BEGIN
  FOR v_booking IN
    SELECT b.id, b.customer_id, b.provider_id, b.target_availability_id,
           b.reschedule_previous_status
    FROM _bookings b
    WHERE b.status = 'RESCHEDULE_REQUESTED'
      AND b.lock_expires_at <= NOW()
      AND b.is_deleted = false
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE _bookings
    SET status = COALESCE(v_booking.reschedule_previous_status, 'CONFIRMED'),
        target_availability_id = NULL,
        reschedule_previous_status = NULL,
        lock_expires_at = NULL,
        updated_at = NOW()
    WHERE id = v_booking.id;

    PERFORM emit_booking_notification(
      v_booking.customer_id, 'RESCHEDULE_REJECTED',
      'Your reschedule request expired without a provider response.',
      jsonb_build_object('booking_id', v_booking.id, 'request_kind', 'RESCHEDULE', 'result', 'EXPIRED')
    );
    v_expired := v_expired + 1;
  END LOOP;

  FOR v_extension IN
    SELECT e.id, e.booking_id, e.requested_by, e.slot_ids
    FROM _booking_extensions e
    WHERE e.status = 'PENDING' AND e.expires_at <= NOW()
  LOOP
    PERFORM id FROM _bookings WHERE id=v_extension.booking_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT e.id,e.booking_id,e.requested_by,e.slot_ids INTO v_extension
    FROM _booking_extensions e
    WHERE e.id=v_extension.id AND e.status='PENDING' AND e.expires_at<=NOW()
    FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;

    PERFORM id FROM _availabilities
    WHERE id = ANY(v_extension.slot_ids)
    ORDER BY id FOR UPDATE;

    PERFORM release_unclaimed_availability_slots(v_extension.slot_ids, v_extension.booking_id, v_extension.id);
    UPDATE _booking_extensions SET status = 'EXPIRED', reviewed_at = NOW()
    WHERE id = v_extension.id AND status = 'PENDING';

    PERFORM emit_booking_notification(
      v_extension.requested_by, 'RESCHEDULE_REJECTED',
      'Your session extension request expired without a provider response.',
      jsonb_build_object(
        'booking_id', v_extension.booking_id,
        'extension_id', v_extension.id,
        'request_kind', 'EXTENSION',
        'result', 'EXPIRED',
        'notification_kind', 'EXTENSION_EXPIRED'
      )
    );
    v_expired := v_expired + 1;
  END LOOP;

  RETURN v_expired;
END;
$$ LANGUAGE plpgsql;

-- Enforce interval overlap checks in addition to the row locks and is_booked
-- flags. This covers reschedule target ranges, not just their first slot ID.
CREATE OR REPLACE FUNCTION prevent_double_booking_lock() RETURNS TRIGGER AS $$
DECLARE
  v_duration INTEGER;
  v_start TIMESTAMPTZ;
  v_target_start TIMESTAMPTZ;
BEGIN
  SELECT COALESCE(NEW.duration_minutes, s.duration_minutes)
  INTO v_duration FROM _services s WHERE s.id = NEW.service_id;
  SELECT start_time INTO v_start FROM _availabilities WHERE id = NEW.availability_id;
  IF NEW.target_availability_id IS NOT NULL THEN
    SELECT start_time INTO v_target_start FROM _availabilities WHERE id = NEW.target_availability_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _bookings b
    JOIN _services s ON s.id = b.service_id
    JOIN _availabilities current_slot ON current_slot.id = b.availability_id
    LEFT JOIN _availabilities target_slot ON target_slot.id = b.target_availability_id
    WHERE b.id <> NEW.id AND b.is_deleted = false
      AND b.provider_id = NEW.provider_id
      AND b.status IN ('PENDING','CONFIRMED','RESCHEDULE_REQUESTED','RESCHEDULED')
      AND (b.lock_expires_at IS NULL OR b.lock_expires_at > NOW())
      AND (
        (v_start < current_slot.start_time + COALESCE(b.duration_minutes, s.duration_minutes) * INTERVAL '1 minute'
          AND v_start + v_duration * INTERVAL '1 minute' > current_slot.start_time)
        OR (v_target_start IS NOT NULL AND v_target_start < current_slot.start_time + COALESCE(b.duration_minutes, s.duration_minutes) * INTERVAL '1 minute'
          AND v_target_start + v_duration * INTERVAL '1 minute' > current_slot.start_time)
        OR (b.status = 'RESCHEDULE_REQUESTED' AND target_slot.id IS NOT NULL
          AND v_start < target_slot.start_time + COALESCE(b.duration_minutes, s.duration_minutes) * INTERVAL '1 minute'
          AND v_start + v_duration * INTERVAL '1 minute' > target_slot.start_time)
        OR (b.status = 'RESCHEDULE_REQUESTED' AND target_slot.id IS NOT NULL AND v_target_start IS NOT NULL
          AND v_target_start < target_slot.start_time + COALESCE(b.duration_minutes, s.duration_minutes) * INTERVAL '1 minute'
          AND v_target_start + v_duration * INTERVAL '1 minute' > target_slot.start_time)
      )
  ) THEN
    RAISE EXCEPTION 'Booking time overlaps an existing booking or request';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_double_booking ON _bookings;
CREATE TRIGGER trg_prevent_double_booking
BEFORE INSERT OR UPDATE ON _bookings
FOR EACH ROW
WHEN (NEW.is_deleted = false AND NEW.status IN ('PENDING','CONFIRMED','RESCHEDULE_REQUESTED','RESCHEDULED'))
EXECUTE FUNCTION prevent_double_booking_lock();

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

CREATE OR REPLACE FUNCTION request_safe_reschedule(p_booking_id UUID, p_target_availability_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_booking RECORD;
  v_target_start TIMESTAMPTZ;
  v_slots UUID[];
  v_count INTEGER;
  v_busy BOOLEAN;
  v_chain BOOLEAN;
BEGIN
  PERFORM expire_booking_holds();
  SELECT b.id,b.customer_id,b.provider_id,b.availability_id,b.status,b.duration_minutes,
         current_slot.start_time current_start,s.title,_users.name customer_name
  INTO v_booking
  FROM _bookings b JOIN _services s ON s.id=b.service_id
  JOIN _users ON _users.id=b.customer_id
  JOIN _availabilities current_slot ON current_slot.id=b.availability_id
  WHERE b.id=p_booking_id AND b.is_deleted=false
    AND b.status IN ('PENDING','CONFIRMED','RESCHEDULED')
  FOR UPDATE OF b;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF v_booking.current_start <= NOW() THEN RETURN FALSE; END IF;
  IF EXISTS (SELECT 1 FROM _booking_extensions WHERE booking_id=p_booking_id AND status='PENDING') THEN
    RETURN FALSE;
  END IF;

  SELECT start_time INTO v_target_start FROM _availabilities
  WHERE id=p_target_availability_id AND provider_id=v_booking.provider_id AND is_deleted=false
  FOR UPDATE NOWAIT;
  IF NOT FOUND OR v_target_start <= NOW() OR v_target_start > NOW()+INTERVAL '2 months'
     OR (v_target_start < v_booking.current_start + v_booking.duration_minutes * INTERVAL '1 minute'
       AND v_target_start + v_booking.duration_minutes * INTERVAL '1 minute' > v_booking.current_start) THEN RETURN FALSE; END IF;

  PERFORM id FROM _availabilities WHERE provider_id=v_booking.provider_id
    AND start_time >= v_target_start AND start_time < v_target_start + v_booking.duration_minutes * INTERVAL '1 minute'
    AND is_deleted=false ORDER BY start_time FOR UPDATE NOWAIT;
  SELECT array_agg(id ORDER BY start_time),count(*)::integer,coalesce(bool_or(is_booked),true),
    coalesce(bool_and(start_time=v_target_start+((rn-1)*INTERVAL '15 minutes')
      AND end_time=start_time+INTERVAL '15 minutes'),false)
  INTO v_slots,v_count,v_busy,v_chain FROM (
    SELECT id,start_time,end_time,is_booked,row_number() over(order by start_time) rn
    FROM _availabilities WHERE provider_id=v_booking.provider_id
      AND start_time>=v_target_start AND start_time<v_target_start+v_booking.duration_minutes*INTERVAL '1 minute'
      AND is_deleted=false
  ) a;
  IF v_count<>v_booking.duration_minutes/15 OR v_busy OR NOT v_chain OR v_slots[1]<>p_target_availability_id THEN RETURN FALSE; END IF;

  UPDATE _bookings SET target_availability_id=p_target_availability_id,status='RESCHEDULE_REQUESTED',
    reschedule_previous_status=v_booking.status,lock_expires_at=NOW()+INTERVAL '24 hours',updated_at=NOW()
  WHERE id=p_booking_id;
  PERFORM emit_booking_notification(v_booking.provider_id,'RESCHEDULE_REQUEST',
    v_booking.customer_name || ' requested a new time for ' || v_booking.title || '.',
    jsonb_build_object('booking_id',p_booking_id,'request_kind','RESCHEDULE',
      'current_start',v_booking.current_start,'requested_start',v_target_start));
  RETURN TRUE;
EXCEPTION WHEN lock_not_available THEN RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

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
BEGIN
  PERFORM expire_booking_holds();
  SELECT * INTO b FROM _bookings WHERE id=p_booking_id AND provider_id=p_provider_id
    AND status='RESCHEDULE_REQUESTED' AND lock_expires_at>NOW() AND is_deleted=false FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT start_time INTO v_old_start FROM _availabilities WHERE id=b.availability_id;
  SELECT start_time INTO v_new_start FROM _availabilities WHERE id=b.target_availability_id
    AND provider_id=p_provider_id AND is_deleted=false;
  IF v_old_start IS NULL OR v_new_start IS NULL OR b.duration_minutes IS NULL THEN RETURN; END IF;

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
  IF v_count<>b.duration_minutes/15 OR v_busy OR NOT v_chain OR v_slots[1]<>b.target_availability_id THEN RETURN; END IF;

  PERFORM release_unclaimed_availability_slots(
    (SELECT array_agg(id) FROM _availabilities WHERE provider_id=p_provider_id
      AND start_time>=v_old_start AND start_time<v_old_start+b.duration_minutes*INTERVAL '1 minute' AND is_deleted=false),
    b.id, NULL
  );
  UPDATE _availabilities SET is_booked=true WHERE id=ANY(v_slots);
  UPDATE _bookings SET availability_id=b.target_availability_id,target_availability_id=NULL,
    status='RESCHEDULED',reschedule_previous_status=NULL,lock_expires_at=NULL,updated_at=NOW()
  WHERE id=p_booking_id;
  PERFORM emit_booking_notification(b.customer_id,'RESCHEDULE_APPROVED','Your reschedule request was approved.',
    jsonb_build_object('booking_id',p_booking_id,'request_kind','RESCHEDULE','result','APPROVED','start_time',v_new_start));
  RETURN QUERY SELECT * FROM _bookings WHERE id=p_booking_id;
EXCEPTION WHEN lock_not_available THEN RETURN;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION reject_safe_reschedule(p_booking_id UUID,p_provider_id UUID)
RETURNS SETOF _bookings AS $$
DECLARE v_customer_id UUID;
BEGIN
  PERFORM expire_booking_holds();
  SELECT customer_id INTO v_customer_id FROM _bookings
  WHERE id=p_booking_id AND provider_id=p_provider_id AND status='RESCHEDULE_REQUESTED'
    AND (lock_expires_at IS NULL OR lock_expires_at>NOW()) AND is_deleted=false FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE _bookings SET target_availability_id=NULL,
    status=COALESCE(reschedule_previous_status,'CONFIRMED'),reschedule_previous_status=NULL,
    lock_expires_at=NULL,updated_at=NOW() WHERE id=p_booking_id;
  PERFORM emit_booking_notification(v_customer_id,'RESCHEDULE_REJECTED','Your reschedule request was rejected.',
    jsonb_build_object('booking_id',p_booking_id,'request_kind','RESCHEDULE','result','REJECTED'));
  RETURN QUERY SELECT * FROM _bookings WHERE id=p_booking_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION request_booking_extension(p_booking_id UUID,p_customer_id UUID,p_extra_minutes INTEGER)
RETURNS UUID AS $$
DECLARE
  b RECORD;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_slots UUID[];
  v_count INTEGER;
  v_busy BOOLEAN;
  v_chain BOOLEAN;
  v_price NUMERIC(10,2);
  v_request_id UUID;
BEGIN
  PERFORM expire_booking_holds();
  IF p_extra_minutes NOT IN (15,30,60) THEN RAISE EXCEPTION 'Extension must be 15, 30, or 60 minutes'; END IF;
  SELECT bk.id,bk.customer_id,bk.provider_id,bk.duration_minutes,bk.status,bk.service_id,
         s.duration_minutes service_minutes,s.price,s.title,a.start_time
  INTO b FROM _bookings bk JOIN _services s ON s.id=bk.service_id
    JOIN _availabilities a ON a.id=bk.availability_id
  WHERE bk.id=p_booking_id AND bk.customer_id=p_customer_id AND bk.is_deleted=false
    AND bk.status IN ('PENDING','CONFIRMED','RESCHEDULED') FOR UPDATE OF bk;
  IF NOT FOUND THEN RAISE EXCEPTION 'Upcoming customer booking not found'; END IF;
  IF b.start_time<=NOW() THEN RAISE EXCEPTION 'Upcoming customer booking not found'; END IF;
  IF b.duration_minutes IS NULL OR b.service_minutes<=0 THEN RAISE EXCEPTION 'Booking duration is invalid'; END IF;
  IF EXISTS(SELECT 1 FROM _booking_extensions WHERE booking_id=p_booking_id AND status='PENDING') THEN
    RAISE EXCEPTION 'An extension request is already pending';
  END IF;

  v_start:=b.start_time+b.duration_minutes*INTERVAL '1 minute';
  v_end:=v_start+p_extra_minutes*INTERVAL '1 minute';
  IF EXISTS (
    SELECT 1 FROM _bookings other_booking
    JOIN _services other_service ON other_service.id=other_booking.service_id
    JOIN _availabilities other_start ON other_start.id=other_booking.availability_id
    LEFT JOIN _availabilities other_target ON other_target.id=other_booking.target_availability_id
    WHERE other_booking.id<>p_booking_id AND other_booking.provider_id=b.provider_id
      AND other_booking.is_deleted=false
      AND other_booking.status IN ('PENDING','CONFIRMED','RESCHEDULE_REQUESTED','RESCHEDULED')
      AND (other_booking.lock_expires_at IS NULL OR other_booking.lock_expires_at>NOW())
      AND (
        (v_start<other_start.start_time+COALESCE(other_booking.duration_minutes,other_service.duration_minutes)*INTERVAL '1 minute'
          AND v_end>other_start.start_time)
        OR (other_booking.status='RESCHEDULE_REQUESTED' AND other_target.id IS NOT NULL
          AND v_start<other_target.start_time+COALESCE(other_booking.duration_minutes,other_service.duration_minutes)*INTERVAL '1 minute'
          AND v_end>other_target.start_time)
      )
  ) THEN RAISE EXCEPTION 'Additional slots overlap another booking or reschedule hold'; END IF;

  PERFORM id FROM _availabilities WHERE provider_id=b.provider_id AND start_time>=v_start AND start_time<v_end
    AND is_deleted=false ORDER BY start_time FOR UPDATE NOWAIT;
  SELECT array_agg(id ORDER BY start_time),count(*)::integer,coalesce(bool_or(is_booked),true),
    coalesce(bool_and(start_time=v_start+((rn-1)*INTERVAL '15 minutes') AND end_time=start_time+INTERVAL '15 minutes'),false)
  INTO v_slots,v_count,v_busy,v_chain FROM (
    SELECT id,start_time,end_time,is_booked,row_number() over(order by start_time) rn
    FROM _availabilities WHERE provider_id=b.provider_id AND start_time>=v_start AND start_time<v_end AND is_deleted=false
  ) a;
  IF v_count<>p_extra_minutes/15 OR v_busy OR NOT v_chain THEN RAISE EXCEPTION 'Additional consecutive slots are not available'; END IF;

  UPDATE _availabilities SET is_booked=true WHERE id=ANY(v_slots);
  v_price:=round(b.price*p_extra_minutes/b.service_minutes,2);
  INSERT INTO _booking_extensions(booking_id,requested_by,additional_minutes,additional_price,slot_ids,status,expires_at)
  VALUES(p_booking_id,p_customer_id,p_extra_minutes,v_price,v_slots,'PENDING',NOW()+INTERVAL '15 minutes')
  RETURNING id INTO v_request_id;
  PERFORM emit_booking_notification(b.provider_id,'RESCHEDULE_REQUEST',
    'A customer requested a '||p_extra_minutes||' minute extension for '||b.title||'.',
    jsonb_build_object('booking_id',p_booking_id,'extension_id',v_request_id,'request_kind','EXTENSION',
      'additional_minutes',p_extra_minutes,'additional_price',v_price));
  RETURN v_request_id;
EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'Additional slots are being booked; retry the request';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION respond_booking_extension(p_extension_id UUID,p_provider_id UUID,p_approve BOOLEAN)
RETURNS SETOF _booking_extensions AS $$
DECLARE
  e _booking_extensions%ROWTYPE;
  b _bookings%ROWTYPE;
  v_booking_id UUID;
  v_booking_start TIMESTAMPTZ;
  v_expected_start TIMESTAMPTZ;
  v_slot_ids UUID[];
  v_slot_count INTEGER;
  v_valid_chain BOOLEAN;
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
    SELECT start_time INTO v_booking_start FROM _availabilities WHERE id=b.availability_id AND is_deleted=false;
    IF v_booking_start IS NULL THEN RETURN; END IF;
    v_expected_start:=v_booking_start+b.duration_minutes*INTERVAL '1 minute';
    PERFORM id FROM _availabilities WHERE id=ANY(e.slot_ids)
      ORDER BY start_time FOR UPDATE NOWAIT;
    SELECT array_agg(id ORDER BY start_time),count(*)::integer,
      coalesce(bool_and(is_booked AND NOT is_deleted
        AND start_time=v_expected_start+((rn-1)*INTERVAL '15 minutes')
        AND end_time=start_time+INTERVAL '15 minutes'),false)
    INTO v_slot_ids,v_slot_count,v_valid_chain FROM (
      SELECT id,start_time,end_time,is_booked,is_deleted,
        row_number() over(order by start_time) rn
      FROM _availabilities WHERE id=ANY(e.slot_ids)
    ) held_slots;
    IF v_slot_count<>e.additional_minutes/15 OR NOT v_valid_chain OR v_slot_ids<>e.slot_ids THEN
      RETURN;
    END IF;
    IF EXISTS (
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
    ) THEN RETURN; END IF;

    UPDATE _booking_extensions SET status='APPROVED',reviewed_at=NOW() WHERE id=e.id;
    UPDATE _bookings SET duration_minutes=duration_minutes+e.additional_minutes,
      extension_amount_due=extension_amount_due+e.additional_price,updated_at=NOW() WHERE id=b.id;
    PERFORM emit_booking_notification(b.customer_id,'RESCHEDULE_APPROVED',
      'Your '||e.additional_minutes||' minute session extension was approved.',
      jsonb_build_object('booking_id',b.id,'extension_id',e.id,'request_kind','EXTENSION','result','APPROVED',
        'additional_minutes',e.additional_minutes,'additional_price',e.additional_price));
  ELSE
    PERFORM release_unclaimed_availability_slots(e.slot_ids, b.id, e.id);
    UPDATE _booking_extensions SET status='REJECTED',reviewed_at=NOW() WHERE id=e.id;
    PERFORM emit_booking_notification(b.customer_id,'RESCHEDULE_REJECTED',
      'Your session extension request was rejected.',
      jsonb_build_object('booking_id',b.id,'extension_id',e.id,'request_kind','EXTENSION','result','REJECTED'));
  END IF;
  RETURN QUERY SELECT * FROM _booking_extensions WHERE id=e.id;
EXCEPTION WHEN lock_not_available THEN RETURN;
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
  IF v_start<=NOW() THEN RAISE EXCEPTION 'A started booking cannot be cancelled'; END IF;

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
  PERFORM release_unclaimed_availability_slots(
    v_extension_slots, b.id, NULL
  );
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
BEGIN
  PERFORM expire_booking_holds();
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
    )) AS is_booked
  FROM _availabilities a WHERE a.provider_id=p_provider_id AND a.is_deleted=false AND a.start_time>NOW()
  ORDER BY a.start_time;
END;
$$;

REVOKE EXECUTE ON FUNCTION expire_booking_holds() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION emit_booking_notification(UUID,notification_type,TEXT,JSONB) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION release_unclaimed_availability_slots(UUID[],UUID,UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION request_booking_extension(UUID,UUID,INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION respond_booking_extension(UUID,UUID,BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION cancel_customer_booking(UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION expire_booking_holds() TO service_role;
GRANT EXECUTE ON FUNCTION emit_booking_notification(UUID,notification_type,TEXT,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION release_unclaimed_availability_slots(UUID[],UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION request_booking_extension(UUID,UUID,INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION respond_booking_extension(UUID,UUID,BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION cancel_customer_booking(UUID,UUID) TO service_role;
NOTIFY pgrst, 'reload schema';

COMMIT;
