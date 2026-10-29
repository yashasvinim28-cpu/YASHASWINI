const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261029100000_same_day_availability_and_cancellation_cutoff.sql'), 'utf8');

test('same-day availability migration includes provider-local today in the RPC result', () => {
  assert.match(migration, /\(a\.start_time AT TIME ZONE v_settings\.time_zone\)::DATE >= v_today\s/);
  assert.doesNotMatch(migration, /::DATE >= v_today\s*\+\s*1/);
});

test('booking trigger permits only a future instant on the provider-local current date', () => {
  assert.match(migration, /v_slot\.start_time<=NOW\(\)/);
  assert.match(migration, /v_date < \(NOW\(\) AT TIME ZONE v_settings\.time_zone\)::DATE/);
  assert.doesNotMatch(migration, /v_date <= \(NOW\(\) AT TIME ZONE v_settings\.time_zone\)::DATE/);
});
