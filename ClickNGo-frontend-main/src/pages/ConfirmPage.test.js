import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const confirmPage = readFileSync(fileURLToPath(new URL("./ConfirmPage.jsx", import.meta.url)), "utf8");

describe("booking confirmation", () => {
  it("uses the real booking response and refreshes the authenticated booking list", () => {
    expect(confirmPage).toMatch(/state\?\.booking/);
    expect(confirmPage).toMatch(/fetchWithAuth\("\/bookings\/my"\)/);
    expect(confirmPage).toMatch(/booking\.id \|\| "—"/);
    expect(confirmPage).toMatch(/navigate\("\/profile"/);
    expect(confirmPage).not.toMatch(/Math\.random/);
  });

  it("respects reduced-motion preferences and supports missing navigation state", () => {
    expect(confirmPage).toMatch(/prefers-reduced-motion:reduce/);
    expect(confirmPage).toMatch(/Confirmation Details Unavailable/);
  });
});
