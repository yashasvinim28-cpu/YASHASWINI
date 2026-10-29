const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20261028120000_booking_lifecycle.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');
const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function functionBody(name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = migration.match(new RegExp(`CREATE OR REPLACE FUNCTION ${escapedName}\\([\\s\\S]*?\\$\\$ LANGUAGE plpgsql;`));
  assert.ok(match, `Expected function ${name} in migration`);
  return match[0];
}

test('expiry notifications distinguish expired extensions using the existing enum and payload', () => {
  const expiry = functionBody('expire_booking_holds');
  assert.match(expiry, /v_extension\.requested_by, 'RESCHEDULE_REJECTED'/);
  assert.match(expiry, /'request_kind', 'EXTENSION'/);
  assert.match(expiry, /'result', 'EXPIRED'/);
  assert.match(expiry, /'notification_kind', 'EXTENSION_EXPIRED'/);
  assert.match(schema, /CREATE TYPE notification_type AS ENUM[\s\S]*'RESCHEDULE_REJECTED'/);
});

test('all availability flag clearing is centralized behind ownership checks', () => {
  assert.equal((migration.match(/UPDATE _availabilities(?:\s+\w+)?\s+SET is_booked\s*=\s*false/gi) || []).length, 1);
  const release = functionBody('release_unclaimed_availability_slots');
  assert.match(release, /UPDATE _availabilities a SET is_booked = false/);
  assert.match(release, /b\.status IN \('PENDING','CONFIRMED','RESCHEDULE_REQUESTED','RESCHEDULED'\)/);
  assert.match(release, /b\.status = 'RESCHEDULE_REQUESTED'/);
  assert.match(release, /e\.status = 'PENDING'/);
  for (const name of ['expire_booking_holds', 'approve_safe_reschedule', 'respond_booking_extension', 'cancel_customer_booking']) {
    assert.match(functionBody(name), /release_unclaimed_availability_slots\(/, `${name} must use guarded slot release`);
  }
  assert.match(functionBody('prevent_double_booking_lock'), /Booking time overlaps an existing booking or request/);
  assert.match(migration, /CREATE TRIGGER trg_prevent_double_booking[\s\S]*?EXECUTE FUNCTION prevent_double_booking_lock\(\)/);
});

test('extension due is preserved until a verified extension payment flow exists', () => {
  assert.match(migration, /extension_amount_due=extension_amount_due\+e\.additional_price/);
  assert.doesNotMatch(migration, /extension_amount_due\s*=\s*0/i);
  assert.match(functionBody('cancel_customer_booking'), /status='CANCELLED'/);
});

test('booking, reschedule, and extension procedures keep their expected RPC signatures', () => {
  assert.match(migration, /FUNCTION create_booking_with_slots\([\s\S]*?p_transaction_id TEXT\s*\) RETURNS JSONB/);
  assert.match(migration, /FUNCTION request_safe_reschedule\(p_booking_id UUID, p_target_availability_id UUID\)\s*RETURNS BOOLEAN/);
  assert.match(migration, /FUNCTION approve_safe_reschedule\(p_booking_id UUID,p_provider_id UUID\)\s*RETURNS SETOF _bookings/);
  assert.match(migration, /FUNCTION reject_safe_reschedule\(p_booking_id UUID,p_provider_id UUID\)\s*RETURNS SETOF _bookings/);
  assert.match(migration, /FUNCTION request_booking_extension\(p_booking_id UUID,p_customer_id UUID,p_extra_minutes INTEGER\)\s*RETURNS UUID/);
  assert.match(migration, /FUNCTION respond_booking_extension\(p_extension_id UUID,p_provider_id UUID,p_approve BOOLEAN\)\s*RETURNS SETOF _booking_extensions/);
});

test('reschedule approval, rejection, and expiry retain their transaction outcomes', () => {
  const approve = functionBody('approve_safe_reschedule');
  const reject = functionBody('reject_safe_reschedule');
  const expire = functionBody('expire_booking_holds');
  assert.match(approve, /availability_id=b\.target_availability_id/);
  assert.match(approve, /status='RESCHEDULED'/);
  assert.match(reject, /target_availability_id=NULL/);
  assert.match(reject, /status=COALESCE\(reschedule_previous_status,'CONFIRMED'\)/);
  assert.match(expire, /status = COALESCE\(v_booking\.reschedule_previous_status, 'CONFIRMED'\)/);
  assert.match(expire, /'request_kind', 'RESCHEDULE', 'result', 'EXPIRED'/);
});

test('extension approval, rejection, expiry, and cancellation maintain pending payment and hold state', () => {
  const approveOrReject = functionBody('respond_booking_extension');
  const expire = functionBody('expire_booking_holds');
  const cancel = functionBody('cancel_customer_booking');
  assert.match(approveOrReject, /status='APPROVED'/);
  assert.match(approveOrReject, /duration_minutes=duration_minutes\+e\.additional_minutes/);
  assert.match(approveOrReject, /extension_amount_due=extension_amount_due\+e\.additional_price/);
  assert.match(approveOrReject, /status='REJECTED'/);
  assert.match(expire, /status = 'EXPIRED'/);
  assert.match(expire, /'notification_kind', 'EXTENSION_EXPIRED'/);
  assert.match(cancel, /status='CANCELLED'/);
  assert.doesNotMatch(cancel, /extension_amount_due\s*=\s*0/i);
});
