import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dashboard = readFileSync(fileURLToPath(new URL("./ProviderDashboardPage.jsx", import.meta.url)), "utf8");

describe("provider booking request review", () => {
  it("shows separate filters for cancellation, reschedule, and extension requests", () => {
    expect(dashboard).toMatch(/Booking Requests/);
    expect(dashboard).toMatch(/Cancellation Requests/);
    expect(dashboard).toMatch(/Reschedule Requests/);
    expect(dashboard).toMatch(/Extension Requests/);
    expect(dashboard).toMatch(/booking\.cancellation_requests/);
    expect(dashboard).toMatch(/booking\.reschedule_requests/);
  });

  it("confirms provider decisions and calls the authenticated cancellation action", () => {
    expect(dashboard).toMatch(/window\.confirm\(`\$\{action === "approve" \? "Approve" : "Reject"\} this cancellation request\?`\)/);
    expect(dashboard).toMatch(/\/bookings\/cancellations\/\$\{requestId\}\/\$\{action\}/);
    expect(dashboard).toMatch(/requestAt \? new Date\(requestAt\)\.toLocaleString\(\)/);
  });
});
