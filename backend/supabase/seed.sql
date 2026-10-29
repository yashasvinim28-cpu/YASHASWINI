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

-- Four consecutive 15-minute slots per 60-minute booking.
INSERT INTO _availabilities (id, provider_id, start_time, end_time, is_booked)
SELECT v.id, '10000000-0000-4000-8000-000000000002', v.starts_at, v.starts_at + INTERVAL '15 minutes', true
FROM (VALUES
  ('30000000-0000-4000-8000-000000000001'::uuid, date_trunc('day', NOW()) - INTERVAL '2 days' + INTERVAL '10 hours'),
  ('30000000-0000-4000-8000-000000000002'::uuid, date_trunc('day', NOW()) - INTERVAL '2 days' + INTERVAL '10 hours 15 minutes'),
  ('30000000-0000-4000-8000-000000000003'::uuid, date_trunc('day', NOW()) - INTERVAL '2 days' + INTERVAL '10 hours 30 minutes'),
  ('30000000-0000-4000-8000-000000000004'::uuid, date_trunc('day', NOW()) - INTERVAL '2 days' + INTERVAL '10 hours 45 minutes'),
  ('30000000-0000-4000-8000-000000000005'::uuid, date_trunc('day', NOW()) + INTERVAL '1 day' + INTERVAL '10 hours'),
  ('30000000-0000-4000-8000-000000000006'::uuid, date_trunc('day', NOW()) + INTERVAL '1 day' + INTERVAL '10 hours 15 minutes'),
  ('30000000-0000-4000-8000-000000000007'::uuid, date_trunc('day', NOW()) + INTERVAL '1 day' + INTERVAL '10 hours 30 minutes'),
  ('30000000-0000-4000-8000-000000000008'::uuid, date_trunc('day', NOW()) + INTERVAL '1 day' + INTERVAL '10 hours 45 minutes')
) AS v(id, starts_at)
ON CONFLICT (id) DO NOTHING;

INSERT INTO _bookings (id, customer_id, provider_id, service_id, availability_id, status)
VALUES
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'COMPLETED'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000005', 'CONFIRMED')
ON CONFLICT (id) DO NOTHING;

INSERT INTO _payments (booking_id, amount, status, payment_method, transaction_id)
VALUES
  ('40000000-0000-4000-8000-000000000001', 500.00, 'SUCCESS', 'DEMO', 'demo-txn-completed-001'),
  ('40000000-0000-4000-8000-000000000002', 800.00, 'PENDING', 'DEMO', 'demo-txn-pending-002')
ON CONFLICT (booking_id) DO NOTHING;

INSERT INTO _reviews (booking_id, user_id, rating, comment)
VALUES ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 5, 'Demo review: friendly and professional service.')
ON CONFLICT (booking_id) DO NOTHING;

INSERT INTO _messages (id, conversation_id, sender_id, receiver_id, booking_id, content)
VALUES ('50000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 'Demo message: confirming the appointment time.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO _notifications (id, user_id, type, message)
VALUES
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'BOOKING_CONFIRMED', 'Demo notification: your sample booking is confirmed.'),
  ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'PAYMENT_SUCCESS', 'Demo notification: a sample payment was recorded.')
ON CONFLICT (id) DO NOTHING;

COMMIT;
