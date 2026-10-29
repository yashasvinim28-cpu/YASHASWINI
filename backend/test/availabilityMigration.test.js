const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261028150000_availability_windows_and_provider_day_closures.sql'), 'utf8');

function body(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = migration.match(new RegExp(`CREATE OR REPLACE FUNCTION ${escaped}\\([\\s\\S]*?\\$\\$ LANGUAGE (?:plpgsql|SQL);`));
  assert.ok(found, `Expected function ${name}`);
  return found[0];
}

test('rolling defaults generate tomorrow through day 32 and preserve configured dates', () => {
  const generator = body('ensure_provider_availability_window');
  assert.match(generator, /generate_series\(1, 32\)/);
  assert.match(migration, /opens_at TIME NOT NULL DEFAULT TIME '10:00'/);
  assert.match(migration, /closes_at TIME NOT NULL DEFAULT TIME '18:00'/);
  assert.match(generator, /15 minutes/);
  assert.match(generator, /Any stored rows on a date denote provider-configured hours\/breaks/);
  assert.match(generator, /pg_advisory_xact_lock/);
});

test('provider day closure is persistent, ownership-scoped, and cancels only upcoming active bookings', () => {
  const close = body('block_provider_day');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS _provider_day_blocks/);
  assert.match(close, /b\.provider_id=p_provider_id/);
  assert.match(close, /b\.status IN \('PENDING','CONFIRMED','RESCHEDULE_REQUESTED','RESCHEDULED'\)/);
  assert.match(close, /a\.start_time>NOW\(\)/);
  assert.match(close, /FOR UPDATE OF b NOWAIT/);
  assert.match(close, /PROVIDER_DAY_CLOSURE/);
  assert.doesNotMatch(close, /DELETE FROM _bookings/i);
  assert.match(migration, /CREATE OR REPLACE FUNCTION unblock_provider_day/);
});

test('new bookings and reschedules serialize with day closures and refuse closed dates', () => {
  const guard = body('prevent_booking_on_closed_day');
  assert.match(guard, /pg_advisory_xact_lock/);
  assert.match(guard, /_provider_day_blocks/);
  assert.match(guard, /Provider is closed on the selected date/);
  assert.match(guard, /finish by 6:00 PM/);
  assert.match(migration, /BEFORE INSERT OR UPDATE ON _bookings[\s\S]*?EXECUTE FUNCTION prevent_booking_on_closed_day\(\)/);
});
