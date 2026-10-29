import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const detailPage = readFileSync(
  fileURLToPath(new URL("./DetailPage.jsx", import.meta.url)),
  "utf8",
);
const app = readFileSync(
  fileURLToPath(new URL("../App.jsx", import.meta.url)),
  "utf8",
);
const paymentPage = readFileSync(
  fileURLToPath(new URL("./PaymentPage.jsx", import.meta.url)),
  "utf8",
);

describe("booking date and time selection UI", () => {
  it("keeps the native date picker and removes the redundant date-card grid", () => {
    expect(detailPage).toMatch(/type="date"/);
    expect(detailPage).toMatch(/setSelectedDate\(v\)/);
    expect(detailPage).toMatch(/Show Available Slots/);
    expect(detailPage).not.toMatch(/calendarDays/);
    expect(detailPage).not.toMatch(/Available dates from tomorrow/);
    expect(detailPage).not.toMatch(/status: .*Unavailable/);
  });

  it("initializes the selected date and minimum date using the provider timezone", () => {
    expect(detailPage).toMatch(/svcData\.provider_time_zone \|\| "Asia\/Kolkata"/);
    expect(detailPage).toMatch(/setSelectedDate\(todayLocalDateKey\(timeZone\)\)/);
    expect(detailPage).toMatch(/const minDateAttr = todayLocalDateKey\(providerTimeZone\)/);
  });

  it("fetches only after an explicit request and renders only the selected date slot list", () => {
    expect(detailPage).toMatch(/slotsRequestedDate !== selectedDate\) return undefined/);
    expect(detailPage).toMatch(/\[service\?\.provider_id, selectedDate, slotsRequestedDate, fetchAvailability\]/);
    expect(detailPage).toMatch(/\[service\?\.provider_id, selectedDate\]/);
    expect(detailPage).toMatch(/setSlotsRequestedDate\(null\)/);
    expect(detailPage).toMatch(/availRequestIdRef\.current \+= 1/);
    expect(detailPage).toMatch(/normalizeLocalDateKey\(a\.start_time, providerTimeZone\) === selectedDate/);
    expect(detailPage).toMatch(/slotsForDay\.map\(\(slot\)/);
  });

  it("shows confirmation only after booking API success and reports booking conflicts", () => {
    expect(detailPage).toMatch(/const \{ data \} = await fetchWithAuth\(endpoint/);
    expect(detailPage).toMatch(/navigate\("\/confirm"/);
    expect(detailPage).toMatch(/setBookingError\(message\)/);
    expect(detailPage).toMatch(/role="alert"/);
  });

  it("books pay-after-service directly and keeps online payments on a registered route", () => {
    expect(detailPage).toMatch(/const payAfterService = Number\(service\.price \|\| 0\) > 0 && paymentPlan === "PAY_LATER"/);
    expect(detailPage).toMatch(/if \(Number\(service\.price \|\| 0\) > 0 && !payAfterService\)/);
    expect(detailPage).toMatch(/const endpoint = payAfterService \? "\/payments\/pay-later-booking" : "\/bookings"/);
    expect(app).toMatch(/import PaymentPage from "\.\/pages\/PaymentPage"/);
    expect(app).toMatch(/<Route path="\/payment" element={<PaymentPage \/>} \/>/);
    expect(paymentPage).toMatch(/fetchWithAuth\("\/payments\/order"/);
    expect(paymentPage).toMatch(/fetchWithAuth\("\/payments\/verify-booking"/);
  });

  it("preserves a selected slot across availability refreshes only while it remains bookable", () => {
    expect(detailPage).toMatch(/const refreshedSlot = slotsForDay\.find/);
    expect(detailPage).toMatch(/return refreshedSlot && !refreshedSlot\.disabled \? refreshedSlot : null/);
    expect(detailPage).toMatch(/\[selectedDate, durationMinutes, slotsForDay\]/);
    expect(detailPage).not.toMatch(/\[selectedDate, durationMinutes, rawAvail\]/);
  });

  it("keeps existing slot buttons visible during background refreshes", () => {
    expect(detailPage).toMatch(/availLoading && rawAvail\.length === 0/);
    expect(detailPage).toMatch(/Refreshing availability/);
    expect(detailPage).toMatch(/bookingLoading \|\| \(availLoading && rawAvail\.length === 0\)/);
  });

  it("prevents overlapping requests, times out stalled requests, and ends loading in finally", () => {
    expect(detailPage).toMatch(/availRequestControllerRef\.current\) return/);
    expect(detailPage).toMatch(/setTimeout\(\(\) => controller\.abort\(\), AVAILABILITY_TIMEOUT_MS\)/);
    expect(detailPage).toMatch(/window\.clearTimeout\(timeoutId\)/);
    expect(detailPage).toMatch(/setAvailLoading\(false\)/);
    expect(detailPage).toMatch(/setAvailabilityError\(controller\.signal\.aborted/);
  });

  it("aborts and invalidates an in-flight response when the date changes", () => {
    expect(detailPage).toMatch(/availRequestIdRef\.current \+= 1;\s*availRequestControllerRef\.current\?\.abort\(\)/);
    expect(detailPage).toMatch(/setSlotsRequestedDate\(null\)/);
  });

  it("does not let toast rerenders invalidate the request before its finally cleanup", () => {
    expect(detailPage).toMatch(/const showToastRef = useRef\(showToast\)/);
    expect(detailPage).toMatch(/showToastRef\.current\("Could not load availability"\)/);
    expect(detailPage).not.toMatch(/\}, \[service\?\.provider_id, selectedDate, showToast\]\)/);
  });
});
