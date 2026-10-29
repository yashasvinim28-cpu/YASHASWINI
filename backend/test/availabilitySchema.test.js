const test = require('node:test');
const assert = require('node:assert/strict');
const { isMissingAvailabilitySettings } = require('../utils/availabilitySchema');

test('recognizes only missing relation/schema-cache errors for optional availability settings', () => {
  assert.equal(isMissingAvailabilitySettings({ code: 'PGRST205' }), true);
  assert.equal(isMissingAvailabilitySettings({ code: '42P01' }), true);
  assert.equal(isMissingAvailabilitySettings({ code: '42501' }), false);
  assert.equal(isMissingAvailabilitySettings({ code: '08006' }), false);
  assert.equal(isMissingAvailabilitySettings(null), false);
});
