const test = require('node:test');
const assert = require('node:assert/strict');
const { pickForwardChainFromLockedRows } = require('../utils/bookingSlots');

function slot(id, startIso, endIso) {
  return { id, start_time: startIso, end_time: endIso };
}

const base = [
  slot('before', '2026-04-01T09:45:00.000Z', '2026-04-01T10:00:00.000Z'),
  slot('a', '2026-04-01T10:00:00.000Z', '2026-04-01T10:15:00.000Z'),
  slot('b', '2026-04-01T10:15:00.000Z', '2026-04-01T10:30:00.000Z'),
  slot('c', '2026-04-01T10:30:00.000Z', '2026-04-01T10:45:00.000Z'),
  slot('d', '2026-04-01T10:45:00.000Z', '2026-04-01T11:00:00.000Z'),
];

test('30-minute service uses exactly two slots starting at selected time (a, b), never before', () => {
  const start = new Date('2026-04-01T10:00:00.000Z');
  const chain = pickForwardChainFromLockedRows(base, start, 2);
  assert.deepEqual(chain.map((s) => s.id), ['a', 'b']);
});

test('45-minute service uses three consecutive slots', () => {
  const start = new Date('2026-04-01T10:00:00.000Z');
  const chain = pickForwardChainFromLockedRows(base, start, 3);
  assert.deepEqual(chain.map((s) => s.id), ['a', 'b', 'c']);
});

test('60-minute service uses four consecutive slots', () => {
  const start = new Date('2026-04-01T10:00:00.000Z');
  const chain = pickForwardChainFromLockedRows(base, start, 4);
  assert.deepEqual(chain.map((s) => s.id), ['a', 'b', 'c', 'd']);
});

test('regression: row before selected start in result set is never included', () => {
  const start = new Date('2026-04-01T10:00:00.000Z');
  const chain = pickForwardChainFromLockedRows(base, start, 2);
  assert.equal(chain.some((s) => s.id === 'before'), false);
});

test('unavailable / missing second slot throws', () => {
  const gap = [
    slot('a', '2026-04-01T10:00:00.000Z', '2026-04-01T10:15:00.000Z'),
    slot('c', '2026-04-01T10:30:00.000Z', '2026-04-01T10:45:00.000Z'),
  ];
  const start = new Date('2026-04-01T10:00:00.000Z');
  assert.throws(() => pickForwardChainFromLockedRows(gap, start, 2), /not fully available|Not enough slots/);
});

test('end of day: not enough rows throws', () => {
  const short = [slot('a', '2026-04-01T10:00:00.000Z', '2026-04-01T10:15:00.000Z')];
  const start = new Date('2026-04-01T10:00:00.000Z');
  assert.throws(() => pickForwardChainFromLockedRows(short, start, 2), /Not enough slots available/);
});

test('booking at 10:15 forward-only does not include 10:00', () => {
  const start = new Date('2026-04-01T10:15:00.000Z');
  const chain = pickForwardChainFromLockedRows(base, start, 2);
  assert.deepEqual(chain.map((s) => s.id), ['b', 'c']);
  assert.equal(chain.some((s) => s.id === 'a'), false);
});
