const test = require('node:test');
const assert = require('node:assert/strict');
const {
  requiredSlotCount,
  isAllowedExtension,
  intervalsOverlap,
  proratedExtensionPrice,
} = require('../utils/bookingLifecycle');

test('a 60-minute booking reserves four 15-minute blocks', () => {
  assert.equal(requiredSlotCount(60), 4);
  assert.throws(() => requiredSlotCount(50), /multiple of 15/);
});

test('reschedule conflict detection catches an overlap inside a multi-block booking', () => {
  assert.equal(intervalsOverlap('2026-05-01T10:00:00Z', 60, '2026-05-01T10:45:00Z', 30), true);
  assert.equal(intervalsOverlap('2026-05-01T10:00:00Z', 60, '2026-05-01T11:00:00Z', 15), false);
});

test('extension increments accept only 15, 30, or 60 minutes', () => {
  assert.equal(isAllowedExtension(15), true);
  assert.equal(isAllowedExtension(30), true);
  assert.equal(isAllowedExtension(60), true);
  assert.equal(isAllowedExtension(45), false);
});

test('extension additional price is prorated from the service duration', () => {
  assert.equal(proratedExtensionPrice(800, 60, 15), 200);
  assert.equal(proratedExtensionPrice(800, 60, 30), 400);
});
