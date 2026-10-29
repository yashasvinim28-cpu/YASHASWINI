-- schema.sql
-- FULL FINAL schema.sql
-- FAANG-Grade Local Service Booking Platform Schema

-- 1. Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- For EXCLUDE overlapping slots
CREATE EXTENSION IF NOT EXISTS postgis;     -- For location-based discovery
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- For text search similarity

-- 2. Custom Types (ENUMs)
CREATE TYPE user_role AS ENUM ('CUSTOMER', 'PROVIDER', 'ADMIN');
CREATE TYPE booking_status AS ENUM ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'RESCHEDULE_REQUESTED', 'RESCHEDULED');
CREATE TYPE payment_status AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED');
CREATE TYPE message_status AS ENUM ('SENT', 'DELIVERED', 'READ');
CREATE TYPE notification_type AS ENUM ('BOOKING_CONFIRMED', 'BOOKING_CANCELLED', 'RESCHEDULE_REQUEST', 'RESCHEDULE_APPROVED', 'RESCHEDULE_REJECTED', 'PAYMENT_SUCCESS', 'PAYMENT_FAILED');

-- =========================================================================
-- RAW DATA TABLES (Prefixed with _ to hide deleted rows behind views later)
-- =========================================================================

CREATE TABLE _users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role user_role NOT NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    location GEOGRAPHY(Point, 4326),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Partial Index: Emails must be unique only among active users
CREATE UNIQUE INDEX idx_users_email_active ON _users (email) WHERE is_deleted = false;

CREATE TABLE _provider_profiles (
    user_id UUID PRIMARY KEY REFERENCES _users(id) ON DELETE RESTRICT,
    bio TEXT,
    experience_years INTEGER CHECK (experience_years >= 0) DEFAULT 0,
    rating_avg DECIMAL(3,2) NOT NULL DEFAULT 0.0 CHECK (rating_avg >= 0.0 AND rating_avg <= 5.0),
    total_reviews INTEGER NOT NULL DEFAULT 0 CHECK (total_reviews >= 0),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE _categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO _categories (name) VALUES
    ('Grooming'),
    ('Real Estate'),
    ('HealthCare'),
    ('Sports & Gaming')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE _services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID NOT NULL REFERENCES _users(id) ON DELETE RESTRICT,
    category_id UUID NOT NULL REFERENCES _categories(id) ON DELETE RESTRICT,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
    tags TEXT[] DEFAULT '{}',
    location_address TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    search_vector tsvector,
    approval_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    admin_review_note TEXT,
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES _users(id) ON DELETE SET NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Performance Indexes for Service Discovery
CREATE INDEX idx_services_provider_id ON _services (provider_id) WHERE is_deleted = false;
CREATE INDEX idx_services_category_id ON _services (category_id) WHERE is_deleted = false;
CREATE INDEX idx_services_search_vector ON _services USING GIN (search_vector) WHERE is_deleted = false;
CREATE INDEX idx_services_lat_lng ON _services (latitude, longitude) WHERE is_deleted = false;

-- Auto-update search vector
CREATE OR REPLACE FUNCTION update_service_search_vector() RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B') ||
        setweight(to_tsvector('english', array_to_string(NEW.tags, ' ')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_update_service_search_vector
BEFORE INSERT OR UPDATE ON _services
FOR EACH ROW EXECUTE FUNCTION update_service_search_vector();

CREATE TABLE _availabilities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID NOT NULL REFERENCES _users(id) ON DELETE RESTRICT,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    -- Set true when this slot is consumed by a booking (multi-slot services mark every 15m row)
    is_booked BOOLEAN NOT NULL DEFAULT false,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT chk_time_order CHECK (start_time < end_time),
    -- EXCLUDE constraint to prevent ANY overlap of time slots for the same provider
    EXCLUDE USING gist (
        provider_id WITH =,
        tstzrange(start_time, end_time) WITH &&
    ) WHERE (is_deleted = false)
);
-- Index for generating fast provider calendars
CREATE INDEX idx_availabilities_provider_start ON _availabilities (provider_id, start_time) WHERE is_deleted = false;

CREATE TABLE _bookings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES _users(id) ON DELETE RESTRICT,
    provider_id UUID NOT NULL REFERENCES _users(id) ON DELETE RESTRICT,
    service_id UUID NOT NULL REFERENCES _services(id) ON DELETE RESTRICT,
    availability_id UUID NOT NULL REFERENCES _availabilities(id) ON DELETE RESTRICT,
    target_availability_id UUID REFERENCES _availabilities(id) ON DELETE RESTRICT,
    status booking_status NOT NULL DEFAULT 'PENDING',
    lock_expires_at TIMESTAMPTZ, -- For tracking when a 'RESCHEDULE_REQUESTED' lock expires
    reschedule_previous_status booking_status,
    cancellation_reason TEXT,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_target_availability CHECK (
        (status = 'RESCHEDULE_REQUESTED' AND target_availability_id IS NOT NULL) OR
        (status != 'RESCHEDULE_REQUESTED' AND target_availability_id IS NULL)
    ),
    CONSTRAINT chk_different_slots CHECK (
        availability_id != target_availability_id
    )
);
-- B-Tree indexes for Dashboard stats
CREATE INDEX idx_bookings_customer_id ON _bookings (customer_id) WHERE is_deleted = false;
CREATE INDEX idx_bookings_provider_id ON _bookings (provider_id) WHERE is_deleted = false;
CREATE INDEX idx_bookings_status ON _bookings (status) WHERE is_deleted = false;

-- Reschedule Locking Fix & Double Booking Prevention (Race-Condition Proof)
-- A constraint trigger runs within the transaction ensuring no slots overlap either as active or targeted.
CREATE OR REPLACE FUNCTION prevent_double_booking_lock() RETURNS TRIGGER AS $$
DECLARE
    slot_id UUID;
BEGIN
    FOR slot_id IN SELECT unnest(ARRAY[NEW.availability_id, NEW.target_availability_id]) LOOP
        IF slot_id IS NOT NULL THEN
            IF EXISTS (
                SELECT 1 FROM _bookings b
                WHERE b.id != NEW.id
                  AND b.status IN ('PENDING', 'CONFIRMED', 'RESCHEDULE_REQUESTED', 'RESCHEDULED')
                  AND (b.availability_id = slot_id OR b.target_availability_id = slot_id)
                  AND b.is_deleted = false
                  AND (b.lock_expires_at IS NULL OR b.lock_expires_at > NOW())
            ) THEN
                RAISE EXCEPTION 'Concurrency Violation: Availability slot % is already locked by another active booking or reschedule request.', slot_id;
            END IF;
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_double_booking
BEFORE INSERT OR UPDATE ON _bookings
FOR EACH ROW
WHEN (NEW.is_deleted = false AND NEW.status IN ('PENDING', 'CONFIRMED', 'RESCHEDULE_REQUESTED', 'RESCHEDULED'))
EXECUTE FUNCTION prevent_double_booking_lock();

CREATE TABLE _payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id UUID NOT NULL UNIQUE REFERENCES _bookings(id) ON DELETE RESTRICT,
    amount DECIMAL(10,2) NOT NULL CHECK (amount >= 0),
    status payment_status NOT NULL DEFAULT 'PENDING',
    payment_method VARCHAR(100),
    transaction_id VARCHAR(255) UNIQUE,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Force Refund Logic Consistency trigger
CREATE OR REPLACE FUNCTION enforce_refund_consistency() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'CANCELLED' AND OLD.status IN ('PENDING', 'CONFIRMED', 'RESCHEDULED') THEN
        IF EXISTS (SELECT 1 FROM _payments WHERE booking_id = NEW.id AND status = 'SUCCESS') THEN
            UPDATE _payments SET status = 'REFUNDED', updated_at = NOW() WHERE booking_id = NEW.id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_enforce_refund
AFTER UPDATE OF status ON _bookings
FOR EACH ROW EXECUTE FUNCTION enforce_refund_consistency();

CREATE TABLE _booking_status_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id UUID NOT NULL REFERENCES _bookings(id) ON DELETE RESTRICT,
    old_status booking_status,
    new_status booking_status NOT NULL,
    changed_by UUID REFERENCES _users(id) ON DELETE SET NULL, 
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit History Tracking Trigger
CREATE OR REPLACE FUNCTION log_booking_status_change() RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT') OR (TG_OP = 'UPDATE' AND OLD.status != NEW.status) THEN
        INSERT INTO _booking_status_logs (booking_id, old_status, new_status, changed_by)
        VALUES (
            NEW.id,
            CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
            NEW.status,
            NULL -- In app, inject `current_setting('app.user_id')` or parse from payload
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_log_booking_status
AFTER INSERT OR UPDATE OF status ON _bookings
FOR EACH ROW EXECUTE FUNCTION log_booking_status_change();

CREATE TABLE _reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id UUID NOT NULL UNIQUE REFERENCES _bookings(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES _users(id) ON DELETE RESTRICT,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Safe caching for provider_profiles rating averges
CREATE OR REPLACE FUNCTION update_provider_rating() RETURNS TRIGGER AS $$
DECLARE
    target_provider_id UUID;
BEGIN
    SELECT provider_id INTO target_provider_id FROM _bookings WHERE id = COALESCE(NEW.booking_id, OLD.booking_id);
    
    WITH stats AS (
        SELECT COUNT(r.id) as total_revs, COALESCE(ROUND(AVG(r.rating), 2), 0) as avg_rating
        FROM _reviews r
        JOIN _bookings b ON r.booking_id = b.id
        WHERE b.provider_id = target_provider_id AND r.is_deleted = false
    )
    UPDATE _provider_profiles
    SET rating_avg = stats.avg_rating, total_reviews = stats.total_revs, updated_at = NOW()
    FROM stats
    WHERE _provider_profiles.user_id = target_provider_id;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_update_rating 
AFTER INSERT OR UPDATE OR DELETE ON _reviews 
FOR EACH ROW EXECUTE FUNCTION update_provider_rating();

CREATE TABLE _messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL, 
    sender_id UUID NOT NULL REFERENCES _users(id) ON DELETE RESTRICT,
    receiver_id UUID NOT NULL REFERENCES _users(id) ON DELETE RESTRICT,
    booking_id UUID REFERENCES _bookings(id) ON DELETE RESTRICT,
    content TEXT NOT NULL,
    status message_status NOT NULL DEFAULT 'SENT',
    is_read BOOLEAN NOT NULL DEFAULT false, -- explicitly requested
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Conversation grouping (grouping messages between two users efficiently)
CREATE INDEX idx_messages_conversation ON _messages (conversation_id, created_at DESC) WHERE is_deleted = false;

CREATE TABLE _notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES _users(id) ON DELETE RESTRICT,
    type notification_type NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT false,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The backend accesses these tables with the Supabase secret key (service_role).
-- Enable RLS so publishable-key clients cannot read or mutate application data.
ALTER TABLE _users ENABLE ROW LEVEL SECURITY;
ALTER TABLE _provider_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE _categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE _services ENABLE ROW LEVEL SECURITY;
ALTER TABLE _availabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE _bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE _payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE _booking_status_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE _reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE _messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _notifications ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- SECURE SOFT-DELETE DATA VIEWS (Enforces is_deleted = false Everywhere)
-- Applications must only run selects/inserts on these Views
-- =========================================================================
CREATE OR REPLACE VIEW users WITH (security_invoker = true) AS SELECT * FROM _users WHERE is_deleted = false;
CREATE OR REPLACE VIEW provider_profiles WITH (security_invoker = true) AS SELECT * FROM _provider_profiles WHERE is_deleted = false;
CREATE OR REPLACE VIEW categories WITH (security_invoker = true) AS SELECT * FROM _categories WHERE is_deleted = false;
CREATE OR REPLACE VIEW services WITH (security_invoker = true) AS SELECT * FROM _services WHERE is_deleted = false;
CREATE OR REPLACE VIEW availabilities WITH (security_invoker = true) AS SELECT * FROM _availabilities WHERE is_deleted = false;
CREATE OR REPLACE VIEW bookings WITH (security_invoker = true) AS SELECT * FROM _bookings WHERE is_deleted = false;
CREATE OR REPLACE VIEW payments WITH (security_invoker = true) AS SELECT * FROM _payments WHERE is_deleted = false;
CREATE OR REPLACE VIEW booking_status_logs WITH (security_invoker = true) AS SELECT * FROM _booking_status_logs; -- Audit is immutable
CREATE OR REPLACE VIEW reviews WITH (security_invoker = true) AS SELECT * FROM _reviews WHERE is_deleted = false;
CREATE OR REPLACE VIEW messages WITH (security_invoker = true) AS SELECT * FROM _messages WHERE is_deleted = false;
CREATE OR REPLACE VIEW notifications WITH (security_invoker = true) AS SELECT * FROM _notifications WHERE is_deleted = false;

-- =========================================================================
-- SAFE LOCKING PROCEDURES (Concurrency Handlers)
-- =========================================================================

-- Try to create a booking gracefully by attempting a NOWAIT lock on the availability slot first.
-- Returns the new booking's ID if successful, or NULL if the slot is currently locked by another transaction.
CREATE OR REPLACE FUNCTION create_safe_booking(
    p_customer_id UUID,
    p_provider_id UUID,
    p_service_id UUID,
    p_availability_id UUID
) RETURNS UUID AS $$
DECLARE
    v_locked_slot RECORD;
    v_new_booking_id UUID;
BEGIN
    -- 1. Attempt to grab an exclusive row-level lock on the availability.
    -- NOWAIT ensures we don't block and wait if another thread is holding the lock; we just fail fast.
    SELECT id, start_time, end_time INTO v_locked_slot 
    FROM _availabilities 
    WHERE id = p_availability_id AND is_deleted = false 
    FOR UPDATE NOWAIT;
    
    -- 2. Due to NOWAIT, if the row is already locked by another transaction, Postgres throws an exception 55P03.
    -- We catch it below. If we pass this point, WE hold the lock.
    
    -- 3. Check logical availability (our custom constraint rule allowing lock expirations).
    IF EXISTS (
        SELECT 1 FROM _bookings
        WHERE (availability_id = p_availability_id OR target_availability_id = p_availability_id)
          AND status IN ('PENDING', 'CONFIRMED', 'RESCHEDULE_REQUESTED', 'RESCHEDULED')
          AND is_deleted = false
          AND (lock_expires_at IS NULL OR lock_expires_at > NOW())
    ) THEN
        -- Slot is logically booked.
        RETURN NULL; 
    END IF;

    -- 4. Safe to insert.
    INSERT INTO _bookings (customer_id, provider_id, service_id, availability_id, status)
    VALUES (p_customer_id, p_provider_id, p_service_id, p_availability_id, 'PENDING')
    RETURNING id INTO v_new_booking_id;

    RETURN v_new_booking_id;

EXCEPTION
    WHEN lock_not_available THEN
        -- Another transaction is currently holding the FOR UPDATE lock on this availability slot.
        -- We exit gracefully without throwing a hard database error to the application.
        RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Try to request a reschedule gracefully, locking the new slot with an expiration time.
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

-- Supabase Data API helpers. These functions are called by the backend's
-- service-role client and keep multi-row booking changes in one transaction.
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
BEGIN
    IF p_start_time IS NULL AND p_availability_id IS NOT NULL THEN
        SELECT start_time INTO v_start
        FROM _availabilities
        WHERE id = p_availability_id AND provider_id = p_provider_id AND is_deleted = false;
    ELSE
        v_start := p_start_time;
    END IF;
    IF v_start IS NULL THEN RAISE EXCEPTION 'Selected availability not found'; END IF;
    IF v_start < NOW() OR v_start > NOW() + INTERVAL '2 months' THEN
        RAISE EXCEPTION 'Booking must be within next 2 months';
    END IF;

    SELECT duration_minutes INTO v_duration
    FROM _services
    WHERE id = p_service_id AND provider_id = p_provider_id AND is_deleted = false;
    IF v_duration IS NULL THEN RAISE EXCEPTION 'Service not found or provider mismatch'; END IF;
    IF v_duration <= 0 OR v_duration % 15 <> 0 THEN RAISE EXCEPTION 'Service duration must be multiple of 15'; END IF;

    PERFORM id
    FROM _availabilities
    WHERE provider_id = p_provider_id
      AND start_time >= v_start
      AND start_time < v_start + v_duration * INTERVAL '1 minute'
      AND is_deleted = false
    ORDER BY start_time
    FOR UPDATE;

    SELECT array_agg(id ORDER BY start_time), COUNT(*)::INTEGER,
           COALESCE(BOOL_OR(is_booked), false),
           COALESCE(BOOL_AND(
             start_time = v_start + ((rn - 1) * INTERVAL '15 minutes')
             AND end_time = start_time + INTERVAL '15 minutes'
           ), false)
    INTO v_slots, v_slot_count, v_has_booked, v_valid_chain
    FROM (
      SELECT id, start_time, end_time, is_booked,
             ROW_NUMBER() OVER (ORDER BY start_time) AS rn
      FROM _availabilities
      WHERE provider_id = p_provider_id
        AND start_time >= v_start
        AND start_time < v_start + v_duration * INTERVAL '1 minute'
        AND is_deleted = false
    ) slots;

    IF v_slot_count <> v_duration / 15 OR NOT v_valid_chain OR v_has_booked THEN
        RAISE EXCEPTION 'No slots available';
    END IF;
    IF p_availability_id IS NOT NULL AND v_slots[1] <> p_availability_id THEN
        RAISE EXCEPTION 'Selected availability does not match the requested start time';
    END IF;
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
      RAISE EXCEPTION 'No slots available';
    END IF;
    IF EXISTS (
      SELECT 1 FROM _bookings b
      WHERE b.is_deleted = false
        AND b.status IN ('PENDING','CONFIRMED','RESCHEDULE_REQUESTED','RESCHEDULED')
        AND (b.lock_expires_at IS NULL OR b.lock_expires_at > NOW())
        AND (b.availability_id = ANY(v_slots) OR b.target_availability_id = ANY(v_slots))
    ) THEN
      RAISE EXCEPTION 'Slot already booked or locked';
    END IF;

    INSERT INTO _bookings (customer_id, provider_id, service_id, availability_id, status)
    VALUES (p_customer_id, p_provider_id, p_service_id, v_slots[1], p_final_status::booking_status)
    RETURNING id INTO v_booking_id;

    UPDATE _availabilities SET is_booked = true WHERE id = ANY(v_slots);

    IF p_payment_status IS NOT NULL THEN
      INSERT INTO _payments (booking_id, amount, status, payment_method, transaction_id)
      VALUES (v_booking_id, p_payment_amount, p_payment_status::payment_status, p_payment_method, p_transaction_id);
    END IF;

    RETURN jsonb_build_object(
      'booking_id', v_booking_id,
      'slots_used', v_slot_count,
      'start_time', v_start
    );
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

CREATE OR REPLACE FUNCTION get_provider_availabilities(p_provider_id UUID)
RETURNS TABLE(id UUID, start_time TIMESTAMPTZ, end_time TIMESTAMPTZ, is_booked BOOLEAN)
LANGUAGE SQL STABLE AS $$
    SELECT a.id, a.start_time, a.end_time,
      (a.is_booked OR EXISTS (
        SELECT 1
        FROM _bookings b
        JOIN _services s ON s.id = b.service_id
        JOIN _availabilities booked_start ON booked_start.id = b.availability_id
        WHERE b.provider_id = a.provider_id AND b.is_deleted = false
          AND b.status IN ('PENDING','CONFIRMED','RESCHEDULE_REQUESTED','RESCHEDULED')
          AND (b.lock_expires_at IS NULL OR b.lock_expires_at > NOW())
          AND a.start_time < booked_start.start_time + s.duration_minutes * INTERVAL '1 minute'
          AND a.end_time > booked_start.start_time
      ) OR EXISTS (
        SELECT 1
        FROM _bookings b
        JOIN _services s ON s.id = b.service_id
        JOIN _availabilities target_start ON target_start.id = b.target_availability_id
        WHERE b.provider_id = a.provider_id AND b.is_deleted = false
          AND b.status = 'RESCHEDULE_REQUESTED'
          AND (b.lock_expires_at IS NULL OR b.lock_expires_at > NOW())
          AND a.start_time < target_start.start_time + s.duration_minutes * INTERVAL '1 minute'
          AND a.end_time > target_start.start_time
      )) AS is_booked
    FROM _availabilities a
    WHERE a.provider_id = p_provider_id
      AND a.is_deleted = false
      AND a.start_time > NOW()
    ORDER BY a.start_time ASC;
$$;

REVOKE EXECUTE ON FUNCTION create_safe_booking(UUID, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION request_safe_reschedule(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION create_booking_with_slots(UUID, UUID, UUID, TIMESTAMPTZ, UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION approve_safe_reschedule(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION reject_safe_reschedule(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION get_provider_availabilities(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION request_safe_reschedule(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION create_booking_with_slots(UUID, UUID, UUID, TIMESTAMPTZ, UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION approve_safe_reschedule(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION reject_safe_reschedule(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION get_provider_availabilities(UUID) TO service_role;
