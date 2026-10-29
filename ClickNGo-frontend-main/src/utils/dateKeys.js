/**
 * Canonical local calendar date as YYYY-MM-DD (matches <input type="date" /> value).
 * Use for comparing user-selected dates to API timestamps without mixing UTC calendar days.
 */
export function normalizeLocalDateKey(isoOrDate, timeZone) {
  const d = typeof isoOrDate === "string" || typeof isoOrDate === "number" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return "";
  if (timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(d);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayLocalDateKey(timeZone) {
  return normalizeLocalDateKey(new Date(), timeZone);
}

export function addLocalDaysDateKey(days, from = new Date(), timeZone) {
  const base = normalizeLocalDateKey(from, timeZone);
  if (!base) return "";
  const [year, month, day] = base.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function tomorrowLocalDateKey(timeZone) {
  return addLocalDaysDateKey(1, new Date(), timeZone);
}
