/**
 * Forward-only multi-slot booking: never consider any availability row that starts
 * before the customer's selected start time.
 *
 * @param {Array<{ id: string, start_time: Date|string, end_time: Date|string }>} slots - rows locked for this provider/window (may be unsorted)
 * @param {Date} start - exact selected slot start (must match one row's start_time)
 * @param {number} slotsNeeded - durationMinutes / slotUnit (e.g. 30/15 => 2)
 * @returns {Array} same rows as slots, in order, length === slotsNeeded
 */
function pickForwardChainFromLockedRows(slots, start, slotsNeeded) {
  if (!Number.isInteger(slotsNeeded) || slotsNeeded < 1) {
    throw new Error('Invalid slot count');
  }

  const sorted = [...slots].sort(
    (a, b) => new Date(a.start_time) - new Date(b.start_time)
  );

  const startMs = start.getTime();
  const idx = sorted.findIndex((s) => new Date(s.start_time).getTime() === startMs);

  if (idx === -1) {
    throw new Error('Selected time slot is not available');
  }

  const selected = [];
  for (let j = 0; j < slotsNeeded; j++) {
    const cur = sorted[idx + j];
    if (!cur) {
      throw new Error('Not enough slots available');
    }
    if (j > 0) {
      const prev = selected[j - 1];
      if (
        new Date(prev.end_time).getTime() !== new Date(cur.start_time).getTime()
      ) {
        throw new Error('Selected time is not fully available');
      }
    }
    selected.push(cur);
  }

  return selected;
}

module.exports = { pickForwardChainFromLockedRows };
