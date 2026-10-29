-- Add two demo listings to Grooming, Real Estate, and HealthCare.
-- Requires the existing active demo provider: demo.provider@clickngo.test.
-- Run manually in the hosted Supabase SQL Editor after reviewing this script.
-- This script never updates or deletes existing records.

BEGIN;

DO $$
DECLARE
  v_provider_id UUID;
  v_category_id UUID;
  v_service RECORD;
  v_existing_category UUID;
  v_existing_status TEXT;
  v_existing_deleted BOOLEAN;
BEGIN
  -- Serialize reruns so title checks and inserts remain repeatable.
  PERFORM pg_advisory_xact_lock(hashtextextended('clickngo-demo-other-categories-seed', 0));

  SELECT id INTO v_provider_id
  FROM _users
  WHERE email = 'demo.provider@clickngo.test'
    AND role = 'PROVIDER'
    AND is_deleted = false;

  IF v_provider_id IS NULL THEN
    RAISE EXCEPTION 'The active demo provider was not found; create it with seed_demo_provider_sports.sql first.';
  END IF;

  FOR v_service IN
    SELECT * FROM (VALUES
      ('Grooming', 'Demo Haircut and Styling', 'A sample haircut and styling appointment.', 450.00::NUMERIC, 60, ARRAY['haircut','styling','demo']::TEXT[]),
      ('Grooming', 'Demo Relaxation Massage', 'A sample relaxation massage appointment.', 900.00::NUMERIC, 60, ARRAY['massage','spa','demo']::TEXT[]),
      ('Real Estate', 'Demo Rental Property Consultation', 'A sample consultation for customers exploring rental properties.', 750.00::NUMERIC, 60, ARRAY['rental','property','demo']::TEXT[]),
      ('Real Estate', 'Demo Property Valuation Visit', 'A sample appointment to discuss a residential property valuation.', 1200.00::NUMERIC, 60, ARRAY['valuation','residential','demo']::TEXT[]),
      ('HealthCare', 'Demo General Physician Consultation', 'A sample general physician consultation listing.', 600.00::NUMERIC, 30, ARRAY['physician','consultation','demo']::TEXT[]),
      ('HealthCare', 'Demo Physiotherapy Session', 'A sample physiotherapy session listing.', 800.00::NUMERIC, 60, ARRAY['physiotherapy','therapy','demo']::TEXT[])
    ) AS sample(category_name, title, description, price, duration_minutes, tags)
  LOOP
    SELECT id INTO v_category_id
    FROM _categories
    WHERE name = v_service.category_name
      AND is_deleted = false;

    IF v_category_id IS NULL THEN
      RAISE EXCEPTION 'The active category "%" was not found.', v_service.category_name;
    END IF;

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
        RAISE EXCEPTION 'A service named "%" already exists but is not an active approved listing in "%"; no existing service was changed.', v_service.title, v_service.category_name;
      END IF;
      -- Existing matching listing is already visible; leave it untouched.
    ELSE
      INSERT INTO _services (
        provider_id, category_id, title, description, price, duration_minutes,
        tags, location_address, latitude, longitude, approval_status,
        is_deleted, reviewed_at, reviewed_by
      ) VALUES (
        v_provider_id, v_category_id, v_service.title, v_service.description,
        v_service.price, v_service.duration_minutes, v_service.tags,
        'Demo location, Bengaluru', 12.9716, 77.5946, 'APPROVED',
        false, NOW(), NULL
      );
    END IF;
  END LOOP;
END;
$$;

COMMIT;
