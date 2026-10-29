-- Demo provider plus approved Sports & Gaming services.
-- Run manually in the hosted Supabase SQL Editor after reviewing this script.
-- The bcrypt hash below matches the demo password documented in README.md.
-- This script never updates an existing user, profile, or service.

BEGIN;

DO $$
DECLARE
  v_email CONSTANT TEXT := 'demo.provider@clickngo.test';
  v_password_hash CONSTANT TEXT := '$2b$10$K/6mKEon0U1aY3SQz0L8BOG0/wSxOLjpwzaKmQMbmu57AuXMkncYO';
  v_provider_id UUID;
  v_role user_role;
  v_existing_hash TEXT;
  v_is_deleted BOOLEAN;
  v_category_id UUID;
  v_profile_deleted BOOLEAN;
  v_service RECORD;
  v_existing_category UUID;
  v_existing_status TEXT;
  v_existing_deleted BOOLEAN;
BEGIN
  -- Serialize reruns so the existence checks below remain idempotent.
  PERFORM pg_advisory_xact_lock(hashtextextended('clickngo-demo-provider-sports-seed', 0));

  -- Insert only when absent. If present, accept only the expected active account
  -- and hash; never alter a pre-existing user.
  INSERT INTO _users (role, name, email, password_hash, phone)
  VALUES ('PROVIDER', 'Demo Provider', v_email, v_password_hash, '0000000002')
  ON CONFLICT (email) DO NOTHING
  RETURNING id INTO v_provider_id;

  IF v_provider_id IS NULL THEN
    SELECT id, role, password_hash, is_deleted
    INTO v_provider_id, v_role, v_existing_hash, v_is_deleted
    FROM _users
    WHERE email = v_email;

    IF NOT FOUND
       OR v_role <> 'PROVIDER'
       OR v_is_deleted
       OR v_existing_hash <> v_password_hash THEN
      RAISE EXCEPTION 'A user already exists for the demo email but is not the expected active demo provider; no user was changed.';
    END IF;
  END IF;

  SELECT id INTO v_category_id
  FROM _categories
  WHERE name = 'Sports & Gaming'
    AND is_deleted = false;

  IF v_category_id IS NULL THEN
    RAISE EXCEPTION 'The active Sports & Gaming category was not found.';
  END IF;

  SELECT is_deleted INTO v_profile_deleted
  FROM _provider_profiles
  WHERE user_id = v_provider_id;

  IF FOUND THEN
    IF v_profile_deleted THEN
      RAISE EXCEPTION 'The demo provider has a soft-deleted profile; no existing profile was changed.';
    END IF;
  ELSE
    INSERT INTO _provider_profiles (user_id, bio, experience_years)
    VALUES (v_provider_id, 'Demo provider profile for Sports & Gaming services.', 3);
  END IF;

  FOR v_service IN
    SELECT * FROM (VALUES
      ('Demo Badminton Court Booking', 'A sample court booking for testing Sports & Gaming discovery.', 500.00::NUMERIC, 60, ARRAY['badminton','court','demo']::TEXT[]),
      ('Demo Gaming Lounge Session', 'A sample gaming lounge session for testing Sports & Gaming discovery.', 300.00::NUMERIC, 60, ARRAY['gaming','arcade','demo']::TEXT[])
    ) AS sample(title, description, price, duration_minutes, tags)
  LOOP
    SELECT category_id, approval_status, is_deleted
    INTO v_existing_category, v_existing_status, v_existing_deleted
    FROM _services
    WHERE provider_id = v_provider_id
      AND title = v_service.title
    LIMIT 1;

    IF FOUND THEN
      IF v_existing_category <> v_category_id
         OR v_existing_status <> 'APPROVED'
         OR v_existing_deleted THEN
        RAISE EXCEPTION 'A service named "%" already exists but is not an active approved Sports & Gaming listing; no existing service was changed.', v_service.title;
      END IF;
      -- Existing matching listing is already usable; leave it untouched.
    ELSE
      INSERT INTO _services (
        provider_id, category_id, title, description, price, duration_minutes,
        tags, location_address, latitude, longitude, approval_status,
        reviewed_at, reviewed_by
      ) VALUES (
        v_provider_id, v_category_id, v_service.title, v_service.description,
        v_service.price, v_service.duration_minutes, v_service.tags,
        'Demo location, Bengaluru', 12.9716, 77.5946, 'APPROVED', NOW(), NULL
      );
    END IF;
  END LOOP;
END;
$$;

COMMIT;
