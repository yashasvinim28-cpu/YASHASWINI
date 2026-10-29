const { localDateTimeToUtc, localDateKeyAt, addDateKeyDays } = require('./localDateRange');

function parseTimeMinutes(value) {
  const match = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value || '');
  if (!match) throw new RangeError('Working hours must use HH:mm format');
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new RangeError('Invalid working hours');
  return hours * 60 + minutes;
}

function buildDefaultAvailabilityRows(providerId, dateKey, timeZone, opensAt = '10:00:00', closesAt = '18:00:00') {
  const opens = Math.max(10 * 60, parseTimeMinutes(opensAt));
  const closes = Math.min(18 * 60, parseTimeMinutes(closesAt));
  if (opens >= closes) return [];

  const rows = [];
  for (let minute = opens; minute + 15 <= closes; minute += 15) {
    rows.push({
      provider_id: providerId,
      start_time: localDateTimeToUtc(dateKey, minute, timeZone),
      end_time: localDateTimeToUtc(dateKey, minute + 15, timeZone),
      is_booked: false,
      is_deleted: false,
    });
  }
  return rows;
}

function keepFutureAvailabilityRows(rows, now = Date.now()) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new RangeError('Current time must be a valid instant');
  return rows.filter((row) => new Date(row.start_time).getTime() > nowMs);
}

module.exports = { buildDefaultAvailabilityRows, keepFutureAvailabilityRows };

function localMinuteAt(instant, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(instant)).map(({ type, value }) => [type, value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function buildRecurringAvailabilityRows(providerId, startTime, endTime, timeZone, now = new Date()) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const nowDate = new Date(now);
  if ([start, end, nowDate].some((value) => Number.isNaN(value.getTime()))) throw new RangeError('Invalid date format');
  if (start >= end) throw new RangeError('end_time must be greater than start_time');

  const startDate = localDateKeyAt(start, timeZone);
  if (startDate !== localDateKeyAt(end, timeZone)) throw new RangeError('Availability range must be within one provider-local day');
  const opens = localMinuteAt(start, timeZone);
  const closes = localMinuteAt(end, timeZone);
  if (opens < 10 * 60 || closes > 18 * 60) {
    throw new RangeError('Provider availability must stay between 10:00 AM and 6:00 PM');
  }
  if (opens % 15 || closes % 15) throw new RangeError('Availability times must align to 15-minute intervals');
  const nowKey = localDateKeyAt(nowDate, timeZone);
  if (startDate < nowKey) throw new RangeError('Cannot create availability in the past');

  const horizon = new Date(`${nowKey}T00:00:00Z`);
  horizon.setUTCMonth(horizon.getUTCMonth() + 2);
  const lastDate = horizon.toISOString().slice(0, 10);
  const rows = [];
  for (let date = startDate; date <= lastDate; date = addDateKeyDays(date, 1)) {
    for (let minute = opens; minute + 15 <= closes; minute += 15) {
      const slotStart = localDateTimeToUtc(date, minute, timeZone);
      const slotEnd = localDateTimeToUtc(date, minute + 15, timeZone);
      if (new Date(slotStart) <= nowDate) continue;
      rows.push({ provider_id: providerId, start_time: slotStart, end_time: slotEnd, is_booked: false, is_deleted: false });
    }
  }
  return rows;
}

module.exports.buildRecurringAvailabilityRows = buildRecurringAvailabilityRows;
