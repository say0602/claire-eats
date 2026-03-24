import { describe, expect, it } from "vitest";
import { normalizeScoreToTenPointScale } from "../lib/scoring";

describe("normalizeScoreToTenPointScale", () => {
  it("returns a neutral score when range is degenerate", () => {
    expect(normalizeScoreToTenPointScale(42, 10, 10)).toBe(5);
    expect(normalizeScoreToTenPointScale(42, 11, 10)).toBe(5);
  });

  it("normalizes values to a 0-10 scale", () => {
    expect(normalizeScoreToTenPointScale(10, 0, 20)).toBe(5);
    expect(normalizeScoreToTenPointScale(0, 0, 20)).toBe(0);
    expect(normalizeScoreToTenPointScale(20, 0, 20)).toBe(10);
  });

  it("clamps out-of-range values to 0-10", () => {
    expect(normalizeScoreToTenPointScale(-5, 0, 20)).toBe(0);
    expect(normalizeScoreToTenPointScale(25, 0, 20)).toBe(10);
  });
});
