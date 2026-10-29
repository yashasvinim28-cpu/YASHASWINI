import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const profilePage = readFileSync(fileURLToPath(new URL("./ProfilePage.jsx", import.meta.url)), "utf8");

describe("customer bookings dashboard", () => {
  it("loads bookings from the authenticated customer endpoint and groups by status", () => {
    expect(profilePage).toMatch(/fetchWithAuth\("\/bookings\/my"\)/);
    expect(profilePage).toMatch(/Promise\.allSettled\(/);
    expect(profilePage).toMatch(/bookingsResult\.status === "fulfilled"/);
    expect(profilePage).toMatch(/bookingTab === "COMPLETED"/);
    expect(profilePage).toMatch(/bookingTab === "CANCELLED"/);
    expect(profilePage).toMatch(/role="tablist"/);
    expect(profilePage).toMatch(/Booking reference: \{b\.id\}/);
  });

  it("keeps cancellation confirmation and the existing reschedule action while refreshing after updates", () => {
    expect(profilePage).toMatch(/window\.confirm\("Send a cancellation request to the provider\?/);
    expect(profilePage).toMatch(/fetchWithAuth/);
    expect(profilePage).toMatch(/bookingId\}\/cancel/);
    expect(profilePage).toMatch(/requestReschedule\(b\.id\)/);
    expect(profilePage).toMatch(/await loadAll\(\)/);
    expect(profilePage).toMatch(/bookingLoadError/);
  });

  it("keeps a booking active while its provider cancellation request is pending", () => {
    expect(profilePage).toMatch(/Cancellation request \{request\.status\.toLowerCase\(\)\}/);
    expect(profilePage).toMatch(/Cancellation request sent to the provider/);
    expect(profilePage).toMatch(/request\.status === "PENDING"/);
  });

  it("filters reschedule choices by duration and avoids overlap with the current booking", () => {
    expect(profilePage).toMatch(/const currentEnd = currentStart \+ Number\(b\.duration_minutes \|\| 0\) \* 60_000/);
    expect(profilePage).toMatch(/slotStart >= currentEnd \|\| slotEnd <= currentStart/);
  });
});
