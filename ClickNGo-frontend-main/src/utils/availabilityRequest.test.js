import { describe, expect, it, vi } from "vitest";
import { fetchAvailabilityRows } from "./availabilityRequest";

describe("availability requests", () => {
  it("returns real rows from a successful API response and forwards cancellation", async () => {
    const rows = [{ id: "slot-1", start_time: "2026-10-29T04:30:00.000Z", is_booked: false }];
    const signal = new AbortController().signal;
    const fetcher = vi.fn().mockResolvedValue({ data: rows });

    await expect(fetchAvailabilityRows(fetcher, "/availabilities/provider?date=2026-10-29", signal)).resolves.toBe(rows);
    expect(fetcher).toHaveBeenCalledWith("/availabilities/provider?date=2026-10-29", { signal });
  });

  it("treats an empty availability array as a successful empty result", async () => {
    await expect(fetchAvailabilityRows(async () => ({ data: [] }), "/availabilities/provider?date=2026-10-29"))
      .resolves.toEqual([]);
  });

  it("propagates API failures and rejects malformed response bodies", async () => {
    await expect(fetchAvailabilityRows(async () => { throw new Error("API unavailable"); }, "/availabilities/provider"))
      .rejects.toThrow("API unavailable");
    await expect(fetchAvailabilityRows(async () => ({ data: { slots: [] } }), "/availabilities/provider"))
      .rejects.toThrow("invalid response");
  });
});
