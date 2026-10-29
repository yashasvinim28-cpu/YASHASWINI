BEGIN;

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

INSERT INTO _booking_reschedule_requests(
  booking_id,customer_id,provider_id,original_availability_id,target_availability_id,status,created_at
)
SELECT b.id,b.customer_id,b.provider_id,b.availability_id,b.target_availability_id,'PENDING',NOW()
FROM _bookings b
WHERE b.status='RESCHEDULE_REQUESTED'
  AND b.target_availability_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM _booking_reschedule_requests r
    WHERE r.booking_id=b.id AND r.status='PENDING'
  );

CREATE OR REPLACE FUNCTION record_booking_reschedule_request()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status='RESCHEDULE_REQUESTED' AND OLD.status IS DISTINCT FROM 'RESCHEDULE_REQUESTED' THEN
    INSERT INTO _booking_reschedule_requests(
      booking_id,customer_id,provider_id,original_availability_id,target_availability_id
    ) VALUES (NEW.id,NEW.customer_id,NEW.provider_id,NEW.availability_id,NEW.target_availability_id);
  ELSIF OLD.status='RESCHEDULE_REQUESTED' AND NEW.status<>'RESCHEDULE_REQUESTED' THEN
    UPDATE _booking_reschedule_requests SET
      status=CASE
        WHEN NEW.status='RESCHEDULED' AND NEW.availability_id IS DISTINCT FROM OLD.availability_id THEN 'APPROVED'
        WHEN OLD.lock_expires_at IS NULL OR OLD.lock_expires_at<=NOW() THEN 'EXPIRED'
        ELSE 'REJECTED'
      END,
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

CREATE OR REPLACE FUNCTION guard_reschedule_request_cutoff()
RETURNS TRIGGER AS $$
DECLARE
  v_start TIMESTAMPTZ;
BEGIN
  IF NEW.status='RESCHEDULE_REQUESTED' AND OLD.status IS DISTINCT FROM 'RESCHEDULE_REQUESTED' THEN
    SELECT start_time INTO v_start FROM _availabilities
    WHERE id=NEW.availability_id AND provider_id=NEW.provider_id AND is_deleted=false;
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

CREATE OR REPLACE FUNCTION guard_booking_against_reschedule_holds()
RETURNS TRIGGER AS $$
DECLARE
  v_duration INTEGER;
  v_start TIMESTAMPTZ;
  v_target_start TIMESTAMPTZ;
  v_guard_start TIMESTAMPTZ;
BEGIN
  IF NEW.is_deleted OR NEW.status NOT IN ('PENDING','CONFIRMED','RESCHEDULE_REQUESTED','RESCHEDULED') THEN
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE'
    AND NEW.provider_id IS NOT DISTINCT FROM OLD.provider_id
    AND NEW.service_id IS NOT DISTINCT FROM OLD.service_id
    AND NEW.availability_id IS NOT DISTINCT FROM OLD.availability_id
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
    ]) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NEW.duration_minutes,s.duration_minutes) INTO v_duration
  FROM _services s
  WHERE s.id=NEW.service_id AND s.provider_id=NEW.provider_id;
  IF v_duration IS NULL OR v_duration<=0 THEN
    RAISE EXCEPTION 'Booking duration is invalid';
  END IF;

  SELECT start_time INTO v_start FROM _availabilities
  WHERE id=NEW.availability_id AND provider_id=NEW.provider_id AND is_deleted=false;
  IF v_start IS NULL THEN
    RAISE EXCEPTION 'Booking availability is invalid';
  END IF;

  IF NEW.status='RESCHEDULE_REQUESTED' THEN
    SELECT start_time INTO v_target_start FROM _availabilities
    WHERE id=NEW.target_availability_id AND provider_id=NEW.provider_id AND is_deleted=false;
    IF v_target_start IS NULL THEN
      RAISE EXCEPTION 'Reschedule target availability is invalid';
    END IF;
    v_guard_start:=v_target_start;
  ELSE
    v_guard_start:=v_start;
  END IF;

  PERFORM a.id FROM _availabilities a
  WHERE a.provider_id=NEW.provider_id AND a.is_deleted=false
    AND a.start_time<v_guard_start+v_duration*INTERVAL '1 minute'
    AND a.end_time>v_guard_start
  ORDER BY a.start_time
  FOR UPDATE;

  IF EXISTS (
    WITH candidate_intervals(start_time) AS (
      SELECT v_guard_start
    )
    SELECT 1
    FROM candidate_intervals candidate
    JOIN _bookings b ON b.provider_id=NEW.provider_id
      AND b.id IS DISTINCT FROM NEW.id
      AND b.is_deleted=false
      AND b.status IN ('PENDING','CONFIRMED','RESCHEDULE_REQUESTED','RESCHEDULED')
      AND (b.lock_expires_at IS NULL OR b.lock_expires_at>NOW())
    JOIN _services s ON s.id=b.service_id
    JOIN _availabilities current_slot ON current_slot.id=b.availability_id
    LEFT JOIN _availabilities target_slot ON target_slot.id=b.target_availability_id
    WHERE (
      candidate.start_time<current_slot.start_time+COALESCE(b.duration_minutes,s.duration_minutes)*INTERVAL '1 minute'
      AND candidate.start_time+v_duration*INTERVAL '1 minute'>current_slot.start_time
    ) OR (
      b.status='RESCHEDULE_REQUESTED'
      AND target_slot.id IS NOT NULL
      AND candidate.start_time<target_slot.start_time+COALESCE(b.duration_minutes,s.duration_minutes)*INTERVAL '1 minute'
      AND candidate.start_time+v_duration*INTERVAL '1 minute'>target_slot.start_time
    )
  ) THEN
    RAISE EXCEPTION 'Booking time conflicts with an existing booking or pending reschedule target';
  END IF;

  IF EXISTS (
    WITH candidate_intervals(start_time) AS (
      SELECT v_guard_start
    )
    SELECT 1
    FROM candidate_intervals candidate
    JOIN _booking_extensions e ON e.status='PENDING'
      AND e.expires_at>NOW()
      AND e.booking_id IS DISTINCT FROM NEW.id
    CROSS JOIN LATERAL UNNEST(e.slot_ids) AS held(slot_id)
    JOIN _availabilities held_slot ON held_slot.id=held.slot_id
      AND held_slot.provider_id=NEW.provider_id
      AND held_slot.is_deleted=false
    WHERE candidate.start_time<held_slot.end_time
      AND candidate.start_time+v_duration*INTERVAL '1 minute'>held_slot.start_time
  ) THEN
    RAISE EXCEPTION 'Booking time conflicts with a pending extension hold';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_double_booking_lock()
RETURNS TRIGGER AS $$
DECLARE
  v_duration INTEGER;
  v_start TIMESTAMPTZ;
  v_target_start TIMESTAMPTZ;
BEGIN
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

  SELECT COALESCE(NEW.duration_minutes, s.duration_minutes)
  INTO v_duration FROM _services s WHERE s.id=NEW.service_id;
  SELECT start_time INTO v_start FROM _availabilities WHERE id=NEW.availability_id;
  IF NEW.target_availability_id IS NOT NULL THEN
    SELECT start_time INTO v_target_start FROM _availabilities WHERE id=NEW.target_availability_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _bookings b
    JOIN _services s ON s.id=b.service_id
    JOIN _availabilities current_slot ON current_slot.id=b.availability_id
    LEFT JOIN _availabilities target_slot ON target_slot.id=b.target_availability_id
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

CREATE OR REPLACE FUNCTION expire_booking_holds()
RETURNS INTEGER AS $$
DECLARE
  v_booking RECORD;
  v_extension RECORD;
  v_target_slots UUID[];
  v_expired INTEGER := 0;
BEGIN
  FOR v_booking IN
    SELECT b.id,b.customer_id,b.provider_id,b.target_availability_id,
      b.reschedule_previous_status,b.duration_minutes,s.duration_minutes AS service_duration,
      target_slot.start_time AS target_start
    FROM _bookings b
    JOIN _services s ON s.id=b.service_id
    LEFT JOIN _availabilities target_slot ON target_slot.id=b.target_availability_id
    WHERE b.status='RESCHEDULE_REQUESTED'
      AND (b.lock_expires_at IS NULL OR b.lock_expires_at<=NOW())
      AND b.is_deleted=false
    FOR UPDATE OF b SKIP LOCKED
  LOOP
    v_target_slots:=NULL;
    IF v_booking.target_start IS NOT NULL THEN
      SELECT array_agg(a.id) INTO v_target_slots
      FROM _availabilities a
      WHERE a.provider_id=v_booking.provider_id
        AND a.start_time>=v_booking.target_start
        AND a.start_time<v_booking.target_start
          +COALESCE(v_booking.duration_minutes,v_booking.service_duration)*INTERVAL '1 minute';
    END IF;

    UPDATE _bookings
    SET status=COALESCE(v_booking.reschedule_previous_status,'CONFIRMED'),
      target_availability_id=NULL,
      reschedule_previous_status=NULL,
      lock_expires_at=NULL,
      updated_at=NOW()
    WHERE id=v_booking.id;

    PERFORM release_unclaimed_availability_slots(v_target_slots,v_booking.id,NULL);
    PERFORM emit_booking_notification(
      v_booking.customer_id,'RESCHEDULE_REJECTED',
      'Your reschedule request expired without a provider response.',
      jsonb_build_object('booking_id',v_booking.id,'request_kind','RESCHEDULE','result','EXPIRED')
    );
    v_expired:=v_expired+1;
  END LOOP;

  FOR v_extension IN
    SELECT e.id,e.booking_id,e.requested_by,e.slot_ids
    FROM _booking_extensions e
    WHERE e.status='PENDING' AND e.expires_at<=NOW()
  LOOP
    PERFORM id FROM _bookings WHERE id=v_extension.booking_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT e.id,e.booking_id,e.requested_by,e.slot_ids INTO v_extension
    FROM _booking_extensions e
    WHERE e.id=v_extension.id AND e.status='PENDING' AND e.expires_at<=NOW()
    FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;

    PERFORM id FROM _availabilities
    WHERE id=ANY(v_extension.slot_ids)
    ORDER BY id FOR UPDATE;

    PERFORM release_unclaimed_availability_slots(v_extension.slot_ids,v_extension.booking_id,v_extension.id);
    UPDATE _booking_extensions SET status='EXPIRED',reviewed_at=NOW()
    WHERE id=v_extension.id AND status='PENDING';

    PERFORM emit_booking_notification(
      v_extension.requested_by,'RESCHEDULE_REJECTED',
      'Your session extension request expired without a provider response.',
      jsonb_build_object(
        'booking_id',v_extension.booking_id,
        'extension_id',v_extension.id,
        'request_kind','EXTENSION',
        'result','EXPIRED',
        'notification_kind','EXTENSION_EXPIRED'
      )
    );
    v_expired:=v_expired+1;
  END LOOP;

  RETURN v_expired;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_booking_against_reschedule_holds ON _bookings;
CREATE TRIGGER trg_guard_booking_against_reschedule_holds
BEFORE INSERT OR UPDATE ON _bookings
FOR EACH ROW
WHEN (NEW.is_deleted=false AND NEW.status IN ('PENDING','CONFIRMED','RESCHEDULE_REQUESTED','RESCHEDULED'))
EXECUTE FUNCTION guard_booking_against_reschedule_holds();

CREATE OR REPLACE FUNCTION approve_safe_reschedule(p_booking_id UUID,p_provider_id UUID)
RETURNS SETOF _bookings AS $$
DECLARE
  b _bookings%ROWTYPE;
  v_old_start TIMESTAMPTZ;
  v_new_start TIMESTAMPTZ;
  v_duration INTEGER;
  v_slots UUID[];
  v_count INTEGER;
  v_busy BOOLEAN;
  v_chain BOOLEAN;
  v_conflict BOOLEAN;
BEGIN
  PERFORM expire_booking_holds();
  SELECT * INTO b FROM _bookings
  WHERE id=p_booking_id AND provider_id=p_provider_id
    AND status='RESCHEDULE_REQUESTED' AND lock_expires_at>NOW() AND is_deleted=false
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT start_time INTO v_old_start FROM _availabilities
  WHERE id=b.availability_id AND provider_id=p_provider_id AND is_deleted=false;
  SELECT start_time INTO v_new_start FROM _availabilities
  WHERE id=b.target_availability_id AND provider_id=p_provider_id AND is_deleted=false;
  SELECT COALESCE(b.duration_minutes,s.duration_minutes) INTO v_duration
  FROM _services s
  WHERE s.id=b.service_id AND s.provider_id=p_provider_id;

  IF v_old_start IS NOT NULL AND v_new_start IS NOT NULL
    AND v_duration IS NOT NULL AND v_duration>0 AND v_duration%15=0 THEN
    PERFORM a.id FROM _availabilities a
    WHERE a.provider_id=p_provider_id
      AND a.start_time>=v_new_start
      AND a.start_time<v_new_start+v_duration*INTERVAL '1 minute'
      AND a.is_deleted=false
    ORDER BY a.start_time
    FOR UPDATE NOWAIT;

    SELECT array_agg(id ORDER BY start_time),COUNT(*)::INTEGER,
      COALESCE(BOOL_OR(is_booked),true),
      COALESCE(BOOL_AND(
        start_time=v_new_start+((rn-1)*INTERVAL '15 minutes')
        AND end_time=start_time+INTERVAL '15 minutes'
      ),false)
    INTO v_slots,v_count,v_busy,v_chain
    FROM (
      SELECT id,start_time,end_time,is_booked,ROW_NUMBER() OVER (ORDER BY start_time) rn
      FROM _availabilities
      WHERE provider_id=p_provider_id
        AND start_time>=v_new_start
        AND start_time<v_new_start+v_duration*INTERVAL '1 minute'
        AND is_deleted=false
    ) target_slots;

    SELECT EXISTS (
      SELECT 1
      FROM _bookings other_booking
      JOIN _services other_service ON other_service.id=other_booking.service_id
      JOIN _availabilities other_start ON other_start.id=other_booking.availability_id
      LEFT JOIN _availabilities other_target ON other_target.id=other_booking.target_availability_id
      WHERE other_booking.id<>b.id
        AND other_booking.provider_id=p_provider_id
        AND other_booking.is_deleted=false
        AND other_booking.status IN ('PENDING','CONFIRMED','RESCHEDULE_REQUESTED','RESCHEDULED')
        AND (other_booking.lock_expires_at IS NULL OR other_booking.lock_expires_at>NOW())
        AND (
          (v_new_start<other_start.start_time+COALESCE(other_booking.duration_minutes,other_service.duration_minutes)*INTERVAL '1 minute'
            AND v_new_start+v_duration*INTERVAL '1 minute'>other_start.start_time)
          OR (other_booking.status='RESCHEDULE_REQUESTED' AND other_target.id IS NOT NULL
            AND v_new_start<other_target.start_time+COALESCE(other_booking.duration_minutes,other_service.duration_minutes)*INTERVAL '1 minute'
            AND v_new_start+v_duration*INTERVAL '1 minute'>other_target.start_time)
        )
    ) OR EXISTS (
      SELECT 1
      FROM _booking_extensions e
      CROSS JOIN LATERAL UNNEST(e.slot_ids) AS held(slot_id)
      JOIN _availabilities held_slot ON held_slot.id=held.slot_id
      WHERE e.booking_id<>b.id
        AND e.status='PENDING'
        AND e.expires_at>NOW()
        AND held_slot.provider_id=p_provider_id
        AND held_slot.is_deleted=false
        AND v_new_start<held_slot.end_time
        AND v_new_start+v_duration*INTERVAL '1 minute'>held_slot.start_time
    ) INTO v_conflict;

    IF v_count=v_duration/15 AND NOT v_busy AND v_chain
      AND v_slots[1]=b.target_availability_id AND NOT v_conflict THEN
      PERFORM release_unclaimed_availability_slots(
        (SELECT array_agg(id) FROM _availabilities
          WHERE provider_id=p_provider_id
            AND start_time>=v_old_start
            AND start_time<v_old_start+v_duration*INTERVAL '1 minute'
            AND is_deleted=false),
        b.id,NULL
      );
      UPDATE _availabilities SET is_booked=true WHERE id=ANY(v_slots);
      UPDATE _bookings SET availability_id=b.target_availability_id,target_availability_id=NULL,
        status='RESCHEDULED',reschedule_previous_status=NULL,lock_expires_at=NULL,updated_at=NOW()
      WHERE id=p_booking_id;
      PERFORM emit_booking_notification(b.customer_id,'RESCHEDULE_APPROVED','Your reschedule request was approved.',
        jsonb_build_object('booking_id',p_booking_id,'request_kind','RESCHEDULE','result','APPROVED','start_time',v_new_start));
      RETURN QUERY SELECT * FROM _bookings WHERE id=p_booking_id;
      RETURN;
    END IF;
  END IF;

  UPDATE _bookings SET target_availability_id=NULL,
    status=COALESCE(reschedule_previous_status,'CONFIRMED'),reschedule_previous_status=NULL,
    lock_expires_at=NULL,updated_at=NOW()
  WHERE id=p_booking_id;
  PERFORM release_unclaimed_availability_slots(v_slots,b.id,NULL);
  PERFORM emit_booking_notification(b.customer_id,'RESCHEDULE_REJECTED',
    'The requested time was no longer available. Your original booking is unchanged.',
    jsonb_build_object('booking_id',p_booking_id,'request_kind','RESCHEDULE','result','REJECTED'));
  RETURN;
EXCEPTION WHEN lock_not_available THEN
  SELECT * INTO b FROM _bookings
  WHERE id=p_booking_id AND provider_id=p_provider_id
    AND status='RESCHEDULE_REQUESTED' AND is_deleted=false
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT start_time INTO v_new_start FROM _availabilities
  WHERE id=b.target_availability_id AND provider_id=p_provider_id AND is_deleted=false;
  SELECT COALESCE(b.duration_minutes,s.duration_minutes) INTO v_duration
  FROM _services s
  WHERE s.id=b.service_id AND s.provider_id=p_provider_id;
  IF v_new_start IS NOT NULL AND v_duration IS NOT NULL AND v_duration>0 THEN
    SELECT array_agg(id) INTO v_slots FROM _availabilities
    WHERE provider_id=p_provider_id
      AND start_time>=v_new_start
      AND start_time<v_new_start+v_duration*INTERVAL '1 minute'
      AND is_deleted=false;
  END IF;

  UPDATE _bookings SET target_availability_id=NULL,
    status=COALESCE(reschedule_previous_status,'CONFIRMED'),reschedule_previous_status=NULL,
    lock_expires_at=NULL,updated_at=NOW()
  WHERE id=p_booking_id;
  PERFORM release_unclaimed_availability_slots(v_slots,b.id,NULL);
  PERFORM emit_booking_notification(b.customer_id,'RESCHEDULE_REJECTED',
    'The requested time could not be locked. Your original booking is unchanged.',
    jsonb_build_object('booking_id',p_booking_id,'request_kind','RESCHEDULE','result','REJECTED'));
  RETURN;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION record_booking_reschedule_request() FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION guard_reschedule_request_cutoff() FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION guard_booking_against_reschedule_holds() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
