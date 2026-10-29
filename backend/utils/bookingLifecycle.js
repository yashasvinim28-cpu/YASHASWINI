const SLOT_MINUTES = 15;
const EXTENSION_INCREMENTS = new Set([15, 30, 60]);

function requiredSlotCount(durationMinutes) {
  const duration = Number(durationMinutes);
  if (!Number.isInteger(duration) || duration <= 0 || duration % SLOT_MINUTES !== 0) {
    throw new Error('Duration must be a positive multiple of 15 minutes');
  }
  return duration / SLOT_MINUTES;
}

function isAllowedExtension(durationMinutes) {
  return EXTENSION_INCREMENTS.has(Number(durationMinutes));
}

function intervalsOverlap(startA, durationA, startB, durationB) {
  const aStart = new Date(startA).getTime();
  const bStart = new Date(startB).getTime();
  if (![aStart, bStart, Number(durationA), Number(durationB)].every(Number.isFinite)) return false;
  return aStart < bStart + Number(durationB) * 60_000
    && aStart + Number(durationA) * 60_000 > bStart;
}

function proratedExtensionPrice(servicePrice, serviceDuration, extraMinutes) {
  const price = Number(servicePrice);
  const duration = Number(serviceDuration);
  const extra = Number(extraMinutes);
  if (!Number.isFinite(price) || price < 0 || !Number.isInteger(duration) || duration <= 0 || !isAllowedExtension(extra)) {
    throw new Error('Invalid extension pricing input');
  }
  return Math.round((price * extra / duration + Number.EPSILON) * 100) / 100;
}

module.exports = { requiredSlotCount, isAllowedExtension, intervalsOverlap, proratedExtensionPrice };
