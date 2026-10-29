-- Repeatable demo data for Sports & Gaming.
-- First register a PROVIDER account through the app so the existing backend
-- generates a real bcrypt password hash. Then replace the email below with
-- that account's email and run this script in the Supabase SQL Editor.
-- This script does not create credentials, approve through the admin workflow,
-- or delete/modify existing service records.

BEGIN;

DO $$
DECLARE
  v_provider_id UUID;
  v_category_id UUID;
BEGIN
  -- Replace this with the email used to register the demo provider.
  SELECT id INTO v_provider_id
  FROM _users
  WHERE email = 'test.provider@clickngo.test'
    AND role = 'PROVIDER'
    AND is_deleted = false;

  IF v_provider_id IS NULL THEN
    RAISE EXCEPTION 'Register a PROVIDER account first, then set its email in this seed script.';
  END IF;

  SELECT id INTO v_category_id
  FROM _categories
  WHERE name = 'Sports & Gaming'
    AND is_deleted = false;

  IF v_category_id IS NULL THEN
    RAISE EXCEPTION 'The Sports & Gaming category was not found.';
  END IF;

  INSERT INTO _provider_profiles (user_id, bio, experience_years)
  VALUES (v_provider_id, 'Demo provider profile for Sports & Gaming services.', 3)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO _services (
    provider_id, category_id, title, description, price, duration_minutes,
    tags, location_address, latitude, longitude, approval_status, reviewed_at
  )
  SELECT v_provider_id, v_category_id, demo.title, demo.description,
         demo.price, demo.duration_minutes, demo.tags,
         'Demo location, Bengaluru', 12.9716, 77.5946,
         'APPROVED', NOW()
  FROM (VALUES
    ('Demo Badminton Court Booking', 'A sample court booking for testing Sports & Gaming discovery.', 500.00::numeric, 60, ARRAY['badminton','court','demo']::text[]),
    ('Demo Gaming Lounge Session', 'A sample gaming lounge session for testing category listings.', 300.00::numeric, 60, ARRAY['gaming','arcade','demo']::text[])
  ) AS demo(title, description, price, duration_minutes, tags)
  WHERE NOT EXISTS (
    SELECT 1 FROM _services existing
    WHERE existing.provider_id = v_provider_id
      AND existing.title = demo.title
  );
END;
$$;

COMMIT;
