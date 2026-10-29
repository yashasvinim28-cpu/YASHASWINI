import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dashboard = readFileSync(fileURLToPath(new URL("./ProviderDashboardPage.jsx", import.meta.url)), "utf8");
const profile = readFileSync(fileURLToPath(new URL("../ProfilePage.jsx", import.meta.url)), "utf8");

describe("customer and provider booking workflow surfaces", () => {
  it("shows customer and slot details with approve/reject actions for pending bookings", () => {
    expect(dashboard).toMatch(/fetchWithAuth\("\/bookings\/my"\)/);
    expect(dashboard).toMatch(/bookings\.filter\(\(booking\) => booking\.status === "PENDING"\)/);
    expect(dashboard).toMatch(/bookingRequests/);
    expect(dashboard).toMatch(/customer_name/);
    expect(dashboard).toMatch(/service_title/);
    expect(dashboard).toMatch(/booking\.start_time/);
    expect(dashboard).toMatch(/booking-request\/\$\{action\}/);
    expect(dashboard).toMatch(/await loadDashboard\(\)/);
    expect(dashboard).toMatch(/Approve/);
    expect(dashboard).toMatch(/Reject/);
  });

  it("exposes all three eligible booking actions and marks extension payment as pending", () => {
    expect(profile).toMatch(/Reschedule/);
    expect(profile).toMatch(/Extend Session/);
    expect(profile).toMatch(/Cancel Booking/);
    expect(profile).toMatch(/target_availability_id: target\.availability_id/);
    expect(profile).toMatch(/\/reschedule/);
    expect(profile).toMatch(/extension_payment_status/);
    expect(profile).toMatch(/Payment: \{b\.payment_status\}/);
    expect(profile).toMatch(/PENDING/);
  });
});
