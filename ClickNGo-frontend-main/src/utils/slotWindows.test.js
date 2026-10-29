import { describe, it, expect } from "vitest";
import { buildForwardSlotStarts, isWithinWorkingHours } from "./slotWindows";

function row(id, start, end, is_booked = false) {
  return { id, start_time: start, end_time: end, is_booked };
}

describe("buildForwardSlotStarts", () => {
  const base = [
    row("a", "2026-04-01T10:00:00.000Z", "2026-04-01T10:15:00.000Z"),
    row("b", "2026-04-01T10:15:00.000Z", "2026-04-01T10:30:00.000Z"),
    row("c", "2026-04-01T10:30:00.000Z", "2026-04-01T10:45:00.000Z"),
    row("d", "2026-04-01T10:45:00.000Z", "2026-04-01T11:00:00.000Z"),
  ];

  it("30-minute service: each bookable start implies exactly 2 contiguous 15m rows forward (never a row before that start)", () => {
    const out = buildForwardSlotStarts(base, 30, 0);
    // Bookable starts: 10:00→[a,b], 10:15→[b,c], 10:30→[c,d] — never 9:45–10:00
    expect(out.map((s) => s.availability_id)).toEqual(["a", "b", "c"]);
    const atTen = out.find((s) => s.availability_id === "a");
    expect(atTen?.start_time).toBe("2026-04-01T10:00:00.000Z");
  });

  it("supports 45-minute service", () => {
    const out = buildForwardSlotStarts(base, 45, 0);
    expect(out.map((s) => s.availability_id)).toEqual(["a", "b"]);
  });

  it("supports 60-minute service", () => {
    const out = buildForwardSlotStarts(base, 60, 0);
    expect(out.map((s) => s.availability_id)).toEqual(["a"]);
  });

  it("disables windows when intermediate slot is booked", () => {
    const rows = [base[0], { ...base[1], is_booked: true }, base[2], base[3]];
    const out = buildForwardSlotStarts(rows, 30, 0);
    expect(out.find((s) => s.availability_id === "a")?.disabled).toBe(true);
    expect(out.find((s) => s.availability_id === "a")?.reason).toBe("Booked");
  });

  it("never includes previous slot in a start window", () => {
    const out = buildForwardSlotStarts(base, 30, 0);
    const bStart = out.find((s) => s.availability_id === "b");
    expect(bStart?.start_time).toBe("2026-04-01T10:15:00.000Z");
    expect(bStart?.slot_end_time).toBe("2026-04-01T10:30:00.000Z");
  });

  it("fails near end-of-day when future slots are missing", () => {
    const out = buildForwardSlotStarts(base.slice(0, 3), 60, 0);
    expect(out).toHaveLength(0);
  });

  it("skips windows when future slot continuity breaks", () => {
    const broken = [
      row("x1", "2026-04-01T10:00:00.000Z", "2026-04-01T10:15:00.000Z"),
      row("x2", "2026-04-01T10:30:00.000Z", "2026-04-01T10:45:00.000Z"),
      row("x3", "2026-04-01T10:45:00.000Z", "2026-04-01T11:00:00.000Z"),
    ];
    const out = buildForwardSlotStarts(broken, 30, 0);
    expect(out).toHaveLength(1);
    expect(out[0].availability_id).toBe("x2");
  });
});

describe("10 AM to 6 PM booking bounds", () => {
  it("keeps starts at 10 AM and requires the full duration to end by 6 PM", () => {
    expect(isWithinWorkingHours("2026-10-29T10:00:00", 60)).toBe(true);
    expect(isWithinWorkingHours("2026-10-29T17:00:00", 60)).toBe(true);
    expect(isWithinWorkingHours("2026-10-29T17:15:00", 60)).toBe(false);
    expect(isWithinWorkingHours("2026-10-29T17:30:00", 30)).toBe(true);
    expect(isWithinWorkingHours("2026-10-29T17:45:00", 30)).toBe(false);
    expect(isWithinWorkingHours("2026-10-29T09:45:00", 15)).toBe(false);
    expect(isWithinWorkingHours("2026-10-29T04:30:00.000Z", 60, "Asia/Kolkata")).toBe(true);
    expect(isWithinWorkingHours("2026-10-29T11:30:00.000Z", 30, "Asia/Kolkata")).toBe(true);
    expect(isWithinWorkingHours("2026-10-29T12:15:00.000Z", 30, "Asia/Kolkata")).toBe(false);
  });

  it("evaluates availability in the provider timezone rather than the browser timezone", () => {
    const indiaRows = [
      row("india-10", "2026-10-29T04:30:00.000Z", "2026-10-29T04:45:00.000Z"),
      row("india-1015", "2026-10-29T04:45:00.000Z", "2026-10-29T05:00:00.000Z"),
      row("india-1030", "2026-10-29T05:00:00.000Z", "2026-10-29T05:15:00.000Z"),
      row("india-1045", "2026-10-29T05:15:00.000Z", "2026-10-29T05:30:00.000Z"),
    ];
    const starts = buildForwardSlotStarts(indiaRows, 60, 0, "Asia/Kolkata");
    expect(starts).toHaveLength(1);
    expect(starts[0].disabled).toBe(false);
  });

  it("rejects rows that are contiguous but are not exactly 15 minutes long", () => {
    const malformed = [
      row("a", "2026-04-01T10:00:00.000Z", "2026-04-01T10:10:00.000Z"),
      row("b", "2026-04-01T10:10:00.000Z", "2026-04-01T10:30:00.000Z"),
    ];
    expect(buildForwardSlotStarts(malformed, 30, 0)).toHaveLength(0);
  });

  it("rejects slots outside the strict 10 AM to 6 PM window", () => {
    const providerConfiguredRows = [
      row("early", "2026-10-29T02:30:00.000Z", "2026-10-29T02:45:00.000Z"),
      row("early-next", "2026-10-29T02:45:00.000Z", "2026-10-29T03:00:00.000Z"),
    ];
    expect(buildForwardSlotStarts(providerConfiguredRows, 30, 0, "Asia/Kolkata")).toHaveLength(0);
  });

});
