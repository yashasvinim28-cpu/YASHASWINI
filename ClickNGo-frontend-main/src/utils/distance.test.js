import { describe, it, expect } from "vitest";
import { haversineKm, formatDistance } from "./distance";

describe("distance utils", () => {
  it("calculates a non-zero distance", () => {
    const km = haversineKm(
      { latitude: 22.7196, longitude: 75.8577 },
      { latitude: 28.6139, longitude: 77.209 }
    );
    expect(km).toBeGreaterThan(500);
  });

  it("formats meters and kilometers", () => {
    expect(formatDistance(0.45)).toMatch(/m away/);
    expect(formatDistance(1.2)).toBe("1.2 km away");
  });
});
