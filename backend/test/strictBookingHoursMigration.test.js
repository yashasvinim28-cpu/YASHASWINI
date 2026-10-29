const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261029130000_strict_booking_hours.sql'), 'utf8');

test('strict provider-local hours apply to bookings and reschedules in PostgreSQL', () => {
  assert.match(migration, /CREATE TRIGGER trg_enforce_booking_public_hours[\s\S]*?BEFORE INSERT OR UPDATE ON _bookings/);
  assert.match(migration, /v_local_start::TIME < TIME '10:00'/);
  assert.match(migration, /v_local_end::TIME > TIME '18:00'/);
  assert.match(migration, /FOREACH v_slot_id IN ARRAY ARRAY\[NEW\.availability_id, NEW\.target_availability_id\]/);
  assert.match(migration, /Booking must fit between 10:00 AM and 6:00 PM provider-local time/);
});

test('soft-deleted-slot reschedule recovery bypasses only strict-hours slot validation', () => {
  const guard = migration.match(/CREATE OR REPLACE FUNCTION enforce_booking_public_hours\(\)[\s\S]*?\$\$ LANGUAGE plpgsql;/)?.[0];
  assert.ok(guard, 'Expected enforce_booking_public_hours definition');

  const recoveryStart = guard.indexOf("OLD.status='RESCHEDULE_REQUESTED'");
  const regularHoursStart = guard.indexOf('FOREACH v_slot_id');
  assert.notEqual(recoveryStart, -1);
  assert.ok(recoveryStart < regularHoursStart);
  assert.match(guard, /TG_OP='UPDATE'[\s\S]*?OLD\.status='RESCHEDULE_REQUESTED'/);
  assert.match(guard, /NEW\.status=COALESCE\(OLD\.reschedule_previous_status,'CONFIRMED'\)/);
  assert.match(guard, /NEW\.target_availability_id IS NULL/);
  assert.match(guard, /NEW\.reschedule_previous_status IS NULL/);
  assert.match(guard, /NEW\.lock_expires_at IS NULL/);
  assert.match(guard, /original_slot\.id=OLD\.availability_id[\s\S]*?original_slot\.provider_id=OLD\.provider_id[\s\S]*?original_slot\.is_deleted=true/);
  assert.match(guard, /to_jsonb\(NEW\)-ARRAY\[[\s\S]*?'updated_at'[\s\S]*?\]\)=\(to_jsonb\(OLD\)-ARRAY/);
  assert.match(guard, /v_local_start::TIME < TIME '10:00'/);
  assert.match(guard, /v_local_end::TIME > TIME '18:00'/);
  assert.match(guard, /RAISE EXCEPTION 'Booking must fit between 10:00 AM and 6:00 PM provider-local time'/);
});

test('ordinary overlapping booking protection remains enabled after the recovery exception', () => {
  const overlapMigration = fs.readFileSync(
    path.join(__dirname, '../supabase/migrations/20261029120600_reschedule_only_reconciliation.sql'),
    'utf8'
  );
  const overlapGuard = overlapMigration.match(/CREATE OR REPLACE FUNCTION prevent_double_booking_lock\(\)[\s\S]*?\$\$ LANGUAGE plpgsql;/)?.[0];
  assert.ok(overlapGuard, 'Expected prevent_double_booking_lock definition');

  const recoveryStart = overlapGuard.indexOf("OLD.status='RESCHEDULE_REQUESTED'");
  const overlapCheckStart = overlapGuard.indexOf('IF EXISTS (');
  assert.notEqual(recoveryStart, -1);
  assert.ok(recoveryStart < overlapCheckStart);
  assert.match(overlapGuard, /TG_OP='UPDATE'[\s\S]*?original_slot\.is_deleted=true/);
  assert.match(overlapGuard, /b\.status IN \('PENDING','CONFIRMED','RESCHEDULE_REQUESTED','RESCHEDULED'\)/);
  assert.match(overlapGuard, /RAISE EXCEPTION 'Booking time overlaps an existing booking or request'/);
});

test('availability RPC hides out-of-window rows and extensions cannot run past close', () => {
  assert.match(migration, /GREATEST\(v_settings\.opens_at,TIME '10:00'\)/);
  assert.match(migration, /LEAST\(v_settings\.closes_at,TIME '18:00'\)/);
  assert.match(migration, /CREATE TRIGGER trg_enforce_extension_public_hours[\s\S]*?BEFORE INSERT OR UPDATE ON _booking_extensions/);
  assert.match(migration, /Extended session must finish by 6:00 PM/);
});
