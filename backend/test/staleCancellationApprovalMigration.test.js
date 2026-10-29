const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20261029140000_reject_stale_cancellation_approvals.sql'),
  'utf8',
);

test('late cancellation approval rejects the request without changing the booking or releasing its slot', () => {
  const staleStartBranch = migration.match(/IF v_start IS NULL OR v_start<=NOW\(\) THEN([\s\S]*?)END IF;/);
  assert.ok(staleStartBranch);
  assert.match(staleStartBranch[1], /UPDATE _booking_cancellation_requests SET status='REJECTED',reviewed_at=NOW\(\)/);
  assert.match(staleStartBranch[1], /'request_kind','CANCELLATION','result','REJECTED'/);
  assert.match(staleStartBranch[1], /RETURN QUERY SELECT \* FROM _booking_cancellation_requests/);
  assert.doesNotMatch(staleStartBranch[1], /UPDATE _bookings|release_unclaimed_availability_slots/);
});
