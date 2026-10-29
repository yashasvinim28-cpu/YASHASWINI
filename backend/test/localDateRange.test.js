const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidLocalDate, localDateUtcRange } = require('../utils/localDateRange');

test('validates a real local calendar date', () => {
  assert.equal(isValidLocalDate('2026-10-29'), true);
  assert.equal(isValidLocalDate('2026-02-30'), false);
  assert.equal(isValidLocalDate('2026-1-9'), false);
});

test('converts the selected provider-local date to UTC bounds', () => {
  assert.deepEqual(localDateUtcRange('2026-10-29', 'Asia/Kolkata'), {
    start: '2026-10-28T18:30:00.000Z',
    end: '2026-10-29T18:30:00.000Z',
  });
});

test('uses the correct 23-hour local day across a daylight-saving transition', () => {
  assert.deepEqual(localDateUtcRange('2026-03-08', 'America/New_York'), {
    start: '2026-03-08T05:00:00.000Z',
    end: '2026-03-09T04:00:00.000Z',
  });
});
