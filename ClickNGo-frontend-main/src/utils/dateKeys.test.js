import { describe, it, expect } from "vitest";
import { addLocalDaysDateKey, normalizeLocalDateKey, todayLocalDateKey, tomorrowLocalDateKey } from "./dateKeys";

describe("normalizeLocalDateKey", () => {
  it("returns YYYY-MM-DD for a local Date", () => {
    const d = new Date(2026, 3, 1, 15, 30, 0);
    expect(normalizeLocalDateKey(d)).toBe("2026-04-01");
  });

  it("returns empty for invalid input", () => {
    expect(normalizeLocalDateKey("not a date")).toBe("");
  });

  it("matches the same calendar day for ISO strings parsed in local time", () => {
    const key = normalizeLocalDateKey(new Date("2026-04-01T12:00:00"));
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("todayLocalDateKey", () => {
  it("returns a valid date key", () => {
    expect(todayLocalDateKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

});

describe("local date window helpers", () => {
  it("starts tomorrow and advances through calendar days across month boundaries", () => {
    const from = new Date(2026, 9, 28, 23, 45);
    expect(tomorrowLocalDateKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(addLocalDaysDateKey(1, from)).toBe("2026-10-29");
    expect(addLocalDaysDateKey(30, from)).toBe("2026-11-27");
  });

  it("uses the provider timezone for availability date keys", () => {
    expect(normalizeLocalDateKey("2026-10-28T19:00:00.000Z", "Asia/Kolkata")).toBe("2026-10-29");
  });

  it("covers October 29 through November 29 as 32 inclusive future dates", () => {
    const from = new Date("2026-10-28T06:30:00.000Z");
    expect(addLocalDaysDateKey(1, from, "Asia/Kolkata")).toBe("2026-10-29");
    expect(addLocalDaysDateKey(32, from, "Asia/Kolkata")).toBe("2026-11-29");
  });
});
