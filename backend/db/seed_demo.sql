-- Demo-only sample data. Run AFTER schema.sql in a non-production project.
-- Demo password for all three accounts: ClickNGoDemo!2026
-- Admin sign-in also requires the ADMIN_ACCESS_CODE configured in backend/.env.
-- The email addresses use the reserved .test domain and do not receive email.

BEGIN;

INSERT INTO _users (id, role, name, email, password_hash, phone) VALUES
  ('10000000-0000-4000-8000-000000000001', 'CUSTOMER', 'Demo Customer', 'demo.customer@clickngo.test', '$2b$10$K/6mKEon0U1aY3SQz0L8BOG0/wSxOLjpwzaKmQMbmu57AuXMkncYO', '0000000001'),
  ('10000000-0000-4000-8000-000000000002', 'PROVIDER', 'Demo Provider', 'demo.provider@clickngo.test', '$2b$10$K/6mKEon0U1aY3SQz0L8BOG0/wSxOLjpwzaKmQMbmu57AuXMkncYO', '0000000002'),
  ('10000000-0000-4000-8000-000000000003', 'ADMIN', 'Demo Admin', 'demo.admin@clickngo.test', '$2b$10$K/6mKEon0U1aY3SQz0L8BOG0/wSxOLjpwzaKmQMbmu57AuXMkncYO', '0000000003')
ON CONFLICT (id) DO NOTHING;

-- Remove the old demo reservations and their dependent demo records so a
-- previously seeded database also starts with every demo slot available.
DELETE FROM _reviews
WHERE booking_id IN (
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002'
);
DELETE FROM _payments
WHERE booking_id IN (
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002'
);
DELETE FROM _messages
WHERE booking_id IN (
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002'
);
DELETE FROM _bookings
WHERE id IN (
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002'
);
UPDATE _availabilities
SET is_booked = false
WHERE id IN (
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000004',
  '30000000-0000-4000-8000-000000000005',
  '30000000-0000-4000-8000-000000000006',
  '30000000-0000-4000-8000-000000000007',
  '30000000-0000-4000-8000-000000000008'
);

INSERT INTO _provider_profiles (user_id, bio, experience_years)
VALUES ('10000000-0000-4000-8000-000000000002', 'Sample ClickNGo provider profile for testing.', 5)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO _services (id, provider_id, category_id, title, description, price, duration_minutes, tags, location_address, latitude, longitude, approval_status, reviewed_at, reviewed_by)
SELECT '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', c.id,
       'Demo Home Grooming', 'Sample service record. Contact details and location are fictional.',
       500.00, 60, ARRAY['demo','grooming'], 'Demo location, Bengaluru', 12.9716, 77.5946,
       'APPROVED', NOW(), '10000000-0000-4000-8000-000000000003'
FROM _categories c WHERE c.name = 'Grooming'
ON CONFLICT (id) DO NOTHING;

INSERT INTO _services (id, provider_id, category_id, title, description, price, duration_minutes, tags, location_address, latitude, longitude, approval_status, reviewed_at, reviewed_by)
SELECT '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', c.id,
       'Demo Wellness Consultation', 'Sample wellness service for development previews.',
       800.00, 60, ARRAY['demo','wellness'], 'Demo location, Bengaluru', 12.9716, 77.5946,
       'APPROVED', NOW(), '10000000-0000-4000-8000-000000000003'
FROM _categories c WHERE c.name = 'HealthCare'
ON CONFLICT (id) DO NOTHING;

-- All demo slots start open so customers can immediately try booking.
-- The provider has 15-minute availability from 10:00 to 17:45 for five days.
INSERT INTO _availabilities (id, provider_id, start_time, end_time, is_booked)
SELECT md5('10000000-0000-4000-8000-000000000002' || starts_at::text)::uuid,
       '10000000-0000-4000-8000-000000000002', starts_at,
       starts_at + INTERVAL '15 minutes', false
FROM generate_series(1, 5) AS day_offset
CROSS JOIN generate_series(0, 31) AS slot_offset
CROSS JOIN LATERAL (
  SELECT date_trunc('day', NOW()) + day_offset * INTERVAL '1 day'
         + INTERVAL '10 hours' + slot_offset * INTERVAL '15 minutes' AS starts_at
) AS slots
ON CONFLICT (id) DO NOTHING;
COMMIT;
