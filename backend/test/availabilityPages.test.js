const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchAllPages } = require('../utils/availabilityPages');

test('fetches every availability page past the Supabase 1,000-row response cap', async () => {
  const calls = [];
  const result = await fetchAllPages(async (offset, limit) => {
    calls.push([offset, limit]);
    return Array.from({ length: Math.min(limit, 2124 - offset) }, (_, index) => offset + index);
  });
  assert.equal(result.length, 2124);
  assert.deepEqual(calls, [[0, 900], [900, 900], [1800, 900]]);
});

test('rejects invalid page data rather than returning an incomplete calendar', async () => {
  await assert.rejects(fetchAllPages(async () => null), /invalid page/);
});
