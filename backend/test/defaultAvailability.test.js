const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDefaultAvailabilityRows, keepFutureAvailabilityRows } = require('../utils/defaultAvailability');
const { buildRecurringAvailabilityRows } = require('../utils/defaultAvailability');

test('builds one provider-local 10 AM to 6 PM schedule on the requested future date', () => {
  const rows = buildDefaultAvailabilityRows('provider-id', '2027-01-05', 'Asia/Kolkata');
  assert.equal(rows.length, 32);
  assert.equal(rows[0].start_time, '2027-01-05T04:30:00.000Z');
  assert.equal(rows[0].end_time, '2027-01-05T04:45:00.000Z');
  assert.equal(rows.at(-1).start_time, '2027-01-05T12:15:00.000Z');
  assert.equal(rows.at(-1).end_time, '2027-01-05T12:30:00.000Z');
  assert.ok(rows.every((row) => row.provider_id === 'provider-id' && !row.is_booked && !row.is_deleted));
});

test('uses configured hours and keeps the 15-minute interval', () => {
  const rows = buildDefaultAvailabilityRows('provider-id', '2027-01-05', 'Asia/Kolkata', '11:00:00', '13:00:00');
  assert.equal(rows.length, 8);
  for (let index = 1; index < rows.length; index += 1) {
    assert.equal(new Date(rows[index].start_time) - new Date(rows[index - 1].start_time), 15 * 60 * 1000);
  }
});

test('configured hours cannot expand generated slots beyond 10 AM to 6 PM', () => {
  const rows = buildDefaultAvailabilityRows('provider-id', '2027-01-05', 'Asia/Kolkata', '09:00:00', '19:00:00');
  assert.equal(rows.length, 32);
  assert.equal(rows[0].start_time, '2027-01-05T04:30:00.000Z');
  assert.equal(rows.at(-1).end_time, '2027-01-05T12:30:00.000Z');
  assert.deepEqual(buildDefaultAvailabilityRows('provider-id', '2027-01-05', 'Asia/Kolkata', '18:15:00', '20:00:00'), []);
});

test('same-day defaults retain only provider-local future starts before opening, during hours, and after closing', () => {
  const rows = buildDefaultAvailabilityRows('provider-id', '2026-10-29', 'Asia/Kolkata');
  const beforeOpening = keepFutureAvailabilityRows(rows, '2026-10-29T03:30:00.000Z'); // 9:00 AM
  assert.equal(beforeOpening.length, 32);
  assert.equal(beforeOpening[0].start_time, '2026-10-29T04:30:00.000Z'); // 10:00 AM

  const duringHours = keepFutureAvailabilityRows(rows, '2026-10-29T07:50:00.000Z'); // 1:20 PM
  assert.equal(duringHours[0].start_time, '2026-10-29T08:00:00.000Z'); // 1:30 PM
  assert.equal(duringHours.length, 18);

  const afterClosing = keepFutureAvailabilityRows(rows, '2026-10-29T12:30:00.000Z'); // 6:00 PM
  assert.deepEqual(afterClosing, []);
});

test('same-day slot instants remain on the configured provider-local date', () => {
  const rows = buildDefaultAvailabilityRows('provider-id', '2026-10-29', 'America/Los_Angeles');
  assert.equal(rows[0].start_time, '2026-10-29T17:00:00.000Z');
  assert.equal(rows.at(-1).end_time, '2026-10-30T01:00:00.000Z');
});

test('recurring manual availability uses provider-local wall times and aligned consecutive 15-minute slots', () => {
  const rows = buildRecurringAvailabilityRows(
    'provider-id', '2027-01-05T04:30:00.000Z', '2027-01-05T12:30:00.000Z', 'Asia/Kolkata',
    new Date('2027-01-04T00:00:00.000Z'),
  );
  assert.equal(rows.length, 59 * 32);
  assert.equal(rows[0].start_time, '2027-01-05T04:30:00.000Z');
  assert.equal(rows[1].start_time, '2027-01-05T04:45:00.000Z');
  assert.equal(rows.at(-1).end_time, '2027-03-04T12:30:00.000Z');
});

test('manual availability rejects partial 15-minute intervals and overnight ranges', () => {
  assert.throws(() => buildRecurringAvailabilityRows(
    'provider-id', '2027-01-05T04:35:00.000Z', '2027-01-05T12:30:00.000Z', 'Asia/Kolkata',
    new Date('2027-01-04T00:00:00.000Z'),
  ), /align to 15-minute/);
  assert.throws(() => buildRecurringAvailabilityRows(
    'provider-id', '2027-01-05T04:30:00.000Z', '2027-01-06T02:00:00.000Z', 'Asia/Kolkata',
    new Date('2027-01-04T00:00:00.000Z'),
  ), /within one provider-local day/);
  assert.throws(() => buildRecurringAvailabilityRows(
    'provider-id', '2027-01-05T04:15:00.000Z', '2027-01-05T12:30:00.000Z', 'Asia/Kolkata',
    new Date('2027-01-04T00:00:00.000Z'),
  ), /10:00 AM and 6:00 PM/);
});

test('same-day recurring manual availability skips elapsed starts and retains future quarter-hour starts', () => {
  const rows = buildRecurringAvailabilityRows(
    'provider-id', '2026-10-29T04:30:00.000Z', '2026-10-29T06:30:00.000Z', 'Asia/Kolkata',
    new Date('2026-10-29T04:37:00.000Z'),
  );
  assert.equal(rows[0].start_time, '2026-10-29T04:45:00.000Z');
  assert.equal(rows[0].end_time, '2026-10-29T05:00:00.000Z');
});
