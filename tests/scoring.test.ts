import { describe, expect, it } from "vitest";
import { computeCombinedScores, computeRawCombinedScore, normalizeScoreToTenPointScale } from "../lib/scoring";
import type { Restaurant } from "../lib/types";

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

describe("computeRawCombinedScore", () => {
  it("uses both Yelp and Google when both are available", () => {
    const score = computeRawCombinedScore({
      yelp: {
        rating: 4.5,
        review_count: 100,
        price: "$$",
        categories: [],
        lat: 0,
        lng: 0,
      },
      google: {
        rating: 4.2,
        review_count: 80,
        place_id: null,
        maps_url: null,
      },
    });

    expect(score).not.toBeNull();
    expect(score as number).toBeGreaterThan(0);
  });

  it("falls back to Yelp-only score when Google is missing", () => {
    const score = computeRawCombinedScore({
      yelp: {
        rating: 4.5,
        review_count: 100,
        price: "$$",
        categories: [],
        lat: 0,
        lng: 0,
      },
      google: {
        rating: null,
        review_count: null,
        place_id: null,
        maps_url: null,
      },
    });

    expect(score).toBeCloseTo(4.5 * Math.log(100 + 1));
  });
});

describe("computeCombinedScores", () => {
  function makeRestaurant(id: string, yelpReviews: number, yelpRating: number, googleReviews: number | null): Restaurant {
    return {
      id,
      name: `Restaurant ${id}`,
      city: "San Francisco",
      yelp: {
        rating: yelpRating,
        review_count: yelpReviews,
        price: "$$",
        categories: [],
        lat: 37.77,
        lng: -122.42,
      },
      google: {
        rating: googleReviews === null ? null : 4.2,
        review_count: googleReviews,
        place_id: null,
        maps_url: null,
      },
      michelin: {
        award: null,
        green_star: false,
        matched: false,
      },
      combined_score: null,
    };
  }

  it("returns normalized 0-10 scores rounded to one decimal", () => {
    const scored = computeCombinedScores([
      makeRestaurant("a", 50, 4.0, null),
      makeRestaurant("b", 300, 4.7, 500),
      makeRestaurant("c", 120, 4.2, 200),
    ]);

    expect(scored).toHaveLength(3);
    for (const restaurant of scored) {
      expect(restaurant.combined_score).not.toBeNull();
      expect(Number((restaurant.combined_score as number).toFixed(1))).toBe(restaurant.combined_score);
      expect(restaurant.combined_score as number).toBeGreaterThanOrEqual(0);
      expect(restaurant.combined_score as number).toBeLessThanOrEqual(10);
    }
  });
});
