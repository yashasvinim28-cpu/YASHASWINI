const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20261029120600_reschedule_only_reconciliation.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');

function functionBody(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = migration.match(new RegExp(`CREATE OR REPLACE FUNCTION ${escaped}\\([\\s\\S]*?\\$\\$ LANGUAGE plpgsql;`));
  assert.ok(match, `Expected ${name} definition`);
  return match[0];
}

test('migration creates and backfills only the reschedule request history', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS _booking_reschedule_requests/);
  assert.match(migration, /ALTER TABLE _booking_reschedule_requests ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /idx_one_pending_reschedule_request_per_booking[\s\S]*?WHERE status='PENDING'/);
  assert.match(migration, /INSERT INTO _booking_reschedule_requests[\s\S]*?b\.status='RESCHEDULE_REQUESTED'/);
  assert.match(migration, /CREATE TRIGGER trg_record_booking_reschedule_request[\s\S]*?EXECUTE FUNCTION record_booking_reschedule_request\(\)/);
});

test('reschedule requests retain history outcomes and enforce the three-hour cutoff', () => {
  const history = functionBody('record_booking_reschedule_request');
  assert.match(history, /NEW\.status='RESCHEDULE_REQUESTED'/);
  assert.match(history, /NEW\.status='RESCHEDULED'[\s\S]*?'APPROVED'/);
  assert.match(history, /OLD\.lock_expires_at<=NOW\(\)[\s\S]*?'EXPIRED'/);
  const cutoff = functionBody('guard_reschedule_request_cutoff');
  assert.match(cutoff, /NOW\(\)\+INTERVAL '3 hours'/);
  assert.match(migration, /CREATE TRIGGER trg_guard_reschedule_request_cutoff[\s\S]*?EXECUTE FUNCTION guard_reschedule_request_cutoff\(\)/);
});

test('booking writes are protected from pending reschedule targets and extension holds', () => {
  const guard = functionBody('guard_booking_against_reschedule_holds');
  assert.match(guard, /b\.status='RESCHEDULE_REQUESTED'/);
  assert.match(guard, /e\.status='PENDING'[\s\S]*?e\.expires_at>NOW\(\)[\s\S]*?UNNEST\(e\.slot_ids\)/);
  assert.match(guard, /e\.booking_id IS DISTINCT FROM NEW\.id/);
  assert.match(migration, /CREATE TRIGGER trg_guard_booking_against_reschedule_holds[\s\S]*?EXECUTE FUNCTION guard_booking_against_reschedule_holds\(\)/);
});

test('soft-deleted original slots allow only an unchanged reschedule cleanup transition', () => {
  const guard = functionBody('guard_booking_against_reschedule_holds');
  assert.match(guard, /OLD\.status='RESCHEDULE_REQUESTED'/);
  assert.match(guard, /NEW\.status=COALESCE\(OLD\.reschedule_previous_status,'CONFIRMED'\)/);
  assert.match(guard, /NEW\.target_availability_id IS NULL/);
  assert.match(guard, /to_jsonb\(NEW\)-ARRAY\[[\s\S]*?'updated_at'[\s\S]*?\]\)=\(to_jsonb\(OLD\)-ARRAY/);
  assert.ok(guard.indexOf("OLD.status='RESCHEDULE_REQUESTED'") < guard.indexOf('Booking availability is invalid'));
  assert.match(guard, /PERFORM a\.id FROM _availabilities a[\s\S]*?FOR UPDATE/);
  assert.match(guard, /Booking time conflicts with an existing booking or pending reschedule target/);
});

test('overlap protection skips only recovery for a soft-deleted original slot', () => {
  const overlapGuard = functionBody('prevent_double_booking_lock');
  const recoveryStart = overlapGuard.indexOf("OLD.status='RESCHEDULE_REQUESTED'");
  const overlapCheckStart = overlapGuard.indexOf('IF EXISTS (');

  assert.notEqual(recoveryStart, -1);
  assert.ok(recoveryStart < overlapCheckStart);
  assert.match(overlapGuard, /TG_OP='UPDATE'[\s\S]*?OLD\.status='RESCHEDULE_REQUESTED'/);
  assert.match(overlapGuard, /NEW\.status=COALESCE\(OLD\.reschedule_previous_status,'CONFIRMED'\)/);
  assert.match(overlapGuard, /NEW\.target_availability_id IS NULL/);
  assert.match(overlapGuard, /original_slot\.id=OLD\.availability_id[\s\S]*?original_slot\.is_deleted=true/);
  assert.match(overlapGuard, /to_jsonb\(NEW\)-ARRAY\[[\s\S]*?'updated_at'[\s\S]*?\]\)=\(to_jsonb\(OLD\)-ARRAY/);
  assert.match(overlapGuard, /b\.status IN \('PENDING','CONFIRMED','RESCHEDULE_REQUESTED','RESCHEDULED'\)/);
  assert.match(overlapGuard, /RAISE EXCEPTION 'Booking time overlaps an existing booking or request'/);
});

test('null-lock reschedules expire, restore their prior status, and release only unclaimed target slots', () => {
  const expiry = functionBody('expire_booking_holds');
  assert.match(expiry, /b\.lock_expires_at IS NULL OR b\.lock_expires_at<=NOW\(\)/);
  assert.match(expiry, /FOR UPDATE OF b SKIP LOCKED/);
  assert.match(expiry, /COALESCE\(v_booking\.reschedule_previous_status,'CONFIRMED'\)/);
  assert.match(expiry, /release_unclaimed_availability_slots\(v_target_slots,v_booking\.id,NULL\)/);
  assert.match(expiry, /_booking_extensions e[\s\S]*?e\.status='PENDING' AND e\.expires_at<=NOW\(\)/);
  const history = functionBody('record_booking_reschedule_request');
  assert.match(history, /OLD\.lock_expires_at IS NULL OR OLD\.lock_expires_at<=NOW\(\)[\s\S]*?'EXPIRED'/);
});

test('approval restores the original booking when target slots are unavailable or conflicting', () => {
  const approve = functionBody('approve_safe_reschedule');
  assert.match(approve, /FOR UPDATE NOWAIT/);
  assert.match(approve, /COALESCE\(BOOL_OR\(is_booked\),true\)/);
  assert.match(approve, /other_booking\.status='RESCHEDULE_REQUESTED'/);
  assert.match(approve, /e\.status='PENDING'[\s\S]*?e\.expires_at>NOW\(\)/);
  assert.match(approve, /status=COALESCE\(reschedule_previous_status,'CONFIRMED'\)/);
  assert.match(approve, /target_availability_id=NULL/);
  assert.match(approve, /release_unclaimed_availability_slots/);
  assert.match(approve, /RESCHEDULE_REJECTED/);
});

test('migration does not modify cancellation or payment behavior', () => {
  assert.doesNotMatch(migration, /_booking_cancellation_requests|cancel_customer_booking|CANCELLED|_payments|payment_status/i);
});
