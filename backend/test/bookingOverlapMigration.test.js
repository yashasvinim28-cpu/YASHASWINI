const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261029120000_booking_overlap_guard.sql'), 'utf8');

test('booking transaction protects full booking and reschedule intervals plus extension holds', () => {
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /v_start < booked_start\.start_time[\s\S]*?v_start \+ v_duration[\s\S]*?booked_start\.start_time/);
  assert.match(migration, /b\.status = 'RESCHEDULE_REQUESTED'[\s\S]*?target_start\.start_time/);
  assert.match(migration, /e\.status = 'PENDING'[\s\S]*?e\.slot_ids && v_slots/);
  assert.match(migration, /UPDATE _availabilities SET is_booked = true WHERE id = ANY\(v_slots\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION create_booking_with_slots/);
});
