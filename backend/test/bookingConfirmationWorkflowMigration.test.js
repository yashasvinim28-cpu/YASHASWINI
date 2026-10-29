const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20261029150000_booking_confirmation_workflow.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');

function functionBody(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = migration.match(new RegExp(`CREATE OR REPLACE FUNCTION ${escaped}\\([\\s\\S]*?\\$\\$ LANGUAGE plpgsql;`));
  assert.ok(match, `Expected ${name} definition`);
  return match[0];
}

test('provider booking decisions are owner-scoped and lock the pending booking', () => {
  const respond = functionBody('respond_to_booking_request');
  assert.match(respond, /provider_id=p_provider_id[\s\S]*status='PENDING'[\s\S]*FOR UPDATE/);
  assert.match(respond, /_booking_cancellation_requests[\s\S]*status='PENDING'/);
  assert.match(migration, /REVOKE EXECUTE ON FUNCTION respond_to_booking_request\(UUID,UUID,BOOLEAN\) FROM PUBLIC,anon,authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION respond_to_booking_request\(UUID,UUID,BOOLEAN\) TO service_role/);
});

test('approving a booking validates and locks the complete reserved slot chain', () => {
  const respond = functionBody('respond_to_booking_request');
  assert.match(respond, /FOR UPDATE NOWAIT/);
  assert.match(respond, /bool_and\(is_booked AND NOT is_deleted/i);
  assert.match(respond, /start_time=v_start\+\(\(rn-1\)\*INTERVAL '15 minutes'\)/);
  assert.match(respond, /v_slots\[1\] IS DISTINCT FROM b\.availability_id/);
  assert.match(respond, /status='CONFIRMED'/);
});

test('rejecting a booking cancels it and safely releases original and extension holds', () => {
  const respond = functionBody('respond_to_booking_request');
  assert.match(respond, /status='CANCELLED'/);
  assert.match(respond, /UPDATE _booking_extensions SET status='CANCELLED'/);
  assert.match(respond, /release_unclaimed_availability_slots\(v_slots,b\.id,NULL\)/);
  assert.match(respond, /release_unclaimed_availability_slots\(v_extension_slots,b\.id,NULL\)/);
  assert.match(respond, /BOOKING_CANCELLED/);
});

test('pay-after-service booking requests await provider confirmation', () => {
  const controller = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'payments.controller.js'), 'utf8');
  const payLater = controller.match(/const createPayLaterBooking = async \(req, res, next\) => \{[\s\S]*?\n\};/)?.[0];
  assert.ok(payLater, 'Expected createPayLaterBooking controller');
  assert.match(payLater, /finalStatus: 'PENDING'/);
  assert.match(payLater, /status: 'PENDING'/);
  assert.match(payLater, /paymentStatus: totalAmountPaise > 0 \? 'PENDING' : null/);
});

test('provider response API is role-checked and wired to the RPC', () => {
  const controller = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'bookings.controller.js'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'bookings.routes.js'), 'utf8');
  const respond = controller.match(/const respondToBookingRequest = async \(req, res, next\) => \{[\s\S]*?\n\};/)?.[0];
  assert.ok(respond, 'Expected respondToBookingRequest controller');
  assert.match(respond, /req\.user\.role !== 'PROVIDER'/);
  assert.match(respond, /respond_to_booking_request/);
  assert.match(respond, /p_provider_id: req\.user\.id/);
  assert.match(respond, /req\.params\.action/);
  assert.match(routes, /\/:id\/booking-request\/:action/);
});
