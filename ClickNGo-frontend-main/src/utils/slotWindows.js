const BASE_SLOT_MIN = 15;
const OPEN_MINUTE = 10 * 60;
const CLOSE_MINUTE = 18 * 60;

export function isWithinWorkingHours(startTime, durationMinutes, timeZone) {
  const start = new Date(startTime);
  if (Number.isNaN(start.getTime()) || !Number.isFinite(durationMinutes) || durationMinutes <= 0) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    ...(timeZone ? { timeZone } : {}), hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(start);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const startMinute = Number(values.hour) * 60 + Number(values.minute);
  return startMinute >= OPEN_MINUTE && startMinute + durationMinutes <= CLOSE_MINUTE;
}

export function buildForwardSlotStarts(sortedRows, durationMinutes, nowMs = Date.now(), timeZone) {
  const slotsNeeded = durationMinutes / BASE_SLOT_MIN;
  if (!Number.isInteger(slotsNeeded) || slotsNeeded < 1) return [];

  const out = [];
  for (let startIndex = 0; startIndex <= sortedRows.length - slotsNeeded; startIndex++) {
    const first = sortedRows[startIndex];
    const chain = [];
    let ok = true;
    for (let j = 0; j < slotsNeeded; j++) {
      const cur = sortedRows[startIndex + j];
      if (!cur) {
        ok = false;
        break;
      }
      if (new Date(cur.end_time).getTime() - new Date(cur.start_time).getTime() !== BASE_SLOT_MIN * 60_000) {
        ok = false;
        break;
      }
      if (j > 0) {
        const prev = chain[j - 1];
        if (new Date(prev.end_time).getTime() !== new Date(cur.start_time).getTime()) {
          ok = false;
          break;
        }
      }
      chain.push(cur);
    }
    if (!ok) continue;

    if (!isWithinWorkingHours(first.start_time, durationMinutes, timeZone)) continue;

    const anyBooked = chain.some((r) => r.is_booked === true || r.is_booked === "true" || r.is_booked === 1);
    const startMs = new Date(first.start_time).getTime();
    out.push({
      availability_id: first.id,
      start_time: first.start_time,
      slot_end_time: first.end_time,
      disabled: anyBooked || startMs < nowMs,
      reason: anyBooked ? "Booked" : startMs < nowMs ? "Unavailable" : null,
    });
  }
  return out;
}
