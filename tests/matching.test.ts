import { describe, expect, it } from "vitest";
import { getDistanceMeters } from "../lib/matching";

describe("getDistanceMeters", () => {
  it("returns 0 for identical coordinates", () => {
    const distance = getDistanceMeters(
      { lat: 37.7749, lng: -122.4194 },
      { lat: 37.7749, lng: -122.4194 },
    );

    expect(distance).toBe(0);
  });

  it("returns approximate meters for nearby coordinates", () => {
    const distance = getDistanceMeters(
      { lat: 37.7749, lng: -122.4194 },
      { lat: 37.7759, lng: -122.4194 },
    );

    expect(distance).toBeGreaterThan(100);
    expect(distance).toBeLessThan(115);
  });
});
