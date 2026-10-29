const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261029110000_provider_approved_cancellation_requests.sql'), 'utf8');

function functionBody(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = migration.match(new RegExp(`CREATE OR REPLACE FUNCTION ${escaped}\\([\\s\\S]*?\\$\\$ LANGUAGE plpgsql;`));
  assert.ok(match, `Expected ${name} definition`);
  return match[0];
}

test('cancellation requests are durable and do not mutate bookings until provider approval', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS _booking_cancellation_requests/);
  assert.match(migration, /idx_one_pending_cancellation_per_booking[\s\S]*WHERE status='PENDING'/);
  const request = functionBody('request_customer_cancellation');
  assert.match(request, /FOR UPDATE OF bk/);
  assert.match(request, /NOW\(\)\+INTERVAL '3 hours'/);
  assert.match(request, /INSERT INTO _booking_cancellation_requests/);
  assert.doesNotMatch(request, /UPDATE _bookings/);
  assert.match(request, /'request_kind','CANCELLATION','result','PENDING'/);
});

test('only the owning provider can approve and approval atomically cancels and releases the original booking slots', () => {
  const respond = functionBody('respond_customer_cancellation');
  assert.match(respond, /provider_id=p_provider_id[\s\S]*FOR UPDATE/);
  assert.match(respond, /status='PENDING' FOR UPDATE/);
  assert.match(respond, /UPDATE _bookings SET status='CANCELLED'/);
  assert.match(respond, /release_unclaimed_availability_slots/);
  assert.match(respond, /'request_kind','CANCELLATION','result','APPROVED'/);
  assert.match(respond, /'result','REJECTED'/);
  assert.doesNotMatch(respond, /DELETE FROM _bookings/);
});

test('reschedule requests are recorded separately and invalid approval restores the original booking', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS _booking_reschedule_requests/);
  assert.match(migration, /CREATE TRIGGER trg_record_booking_reschedule_request[\s\S]*EXECUTE FUNCTION record_booking_reschedule_request\(\)/);
  assert.match(migration, /original_availability_id,target_availability_id/);
  const cutoff = functionBody('guard_reschedule_request_cutoff');
  assert.match(cutoff, /NOW\(\)\+INTERVAL '3 hours'/);
  const approve = functionBody('approve_safe_reschedule');
  assert.match(approve, /v_count=b\.duration_minutes\/15/);
  assert.match(approve, /bool_or\(is_booked\)/);
  assert.match(approve, /status=COALESCE\(reschedule_previous_status,'CONFIRMED'\)/);
  assert.match(approve, /The requested time was no longer available/);
});

test('pending cancellation cannot race with rescheduling or extension, and RPCs stay service-role-only', () => {
  assert.match(migration, /trg_guard_booking_request_against_cancellation/);
  assert.match(migration, /trg_guard_extension_against_cancellation/);
  assert.match(migration, /REVOKE EXECUTE ON FUNCTION request_customer_cancellation\(UUID,UUID\) FROM PUBLIC,anon,authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION respond_customer_cancellation\(UUID,UUID,BOOLEAN\) TO service_role/);
});

test('pending extension and reschedule requests are mutually exclusive at the database boundary', () => {
  const bookingGuard = functionBody('guard_booking_request_against_pending_cancellation');
  const extensionGuard = functionBody('guard_extension_against_pending_cancellation');
  assert.match(bookingGuard, /_booking_extensions WHERE booking_id=NEW\.id AND status='PENDING'/);
  assert.match(extensionGuard, /_bookings[\s\S]*status='RESCHEDULE_REQUESTED'/);
});
