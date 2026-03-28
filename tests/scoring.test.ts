import { describe, expect, it } from "vitest";
import { computeCombinedScores, computeRawCombinedScore } from "../lib/scoring";
import type { Restaurant } from "../lib/types";

describe("computeRawCombinedScore", () => {
  it("uses review-count weighting on a 10-point scale", () => {
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

    // Yelp 4.5 -> 9.0 (100 reviews), Google 4.2 -> 8.4 (80 reviews)
    // weighted average -> (9.0*100 + 8.4*80) / 180 = 8.733...
    expect(score).toBeCloseTo(8.733, 3);
  });

  it("falls back to Yelp-only 10-point score when Google is missing", () => {
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

    expect(score).toBeCloseTo(9.0);
  });

  it("falls back to Google-only score when Yelp has placeholder zeros", () => {
    const score = computeRawCombinedScore({
      yelp: {
        rating: 0,
        review_count: 0,
        price: null,
        categories: [],
        lat: 0,
        lng: 0,
      },
      google: {
        rating: 4.3,
        review_count: 200,
        place_id: "p1",
        maps_url: null,
      },
    });

    expect(score).toBeCloseTo(8.6);
  });

  it("returns null when both sources have no real ratings", () => {
    const score = computeRawCombinedScore({
      yelp: {
        rating: 0,
        review_count: 0,
        price: null,
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

    expect(score).toBeNull();
  });

  it("treats Google as missing when review_count is 0", () => {
    const score = computeRawCombinedScore({
      yelp: {
        rating: 4.0,
        review_count: 50,
        price: "$$",
        categories: [],
        lat: 0,
        lng: 0,
      },
      google: {
        rating: 4.5,
        review_count: 0,
        place_id: null,
        maps_url: null,
      },
    });

    expect(score).toBeCloseTo(8.0);
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

  it("returns absolute 10-point scores rounded to one decimal", () => {
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

    expect(scored[0].combined_score).toBe(8);
    expect(scored[1].combined_score).toBe(8.8);
    expect(scored[2].combined_score).toBe(8.4);
  });

  it("leans toward source with higher review count", () => {
    const score = computeRawCombinedScore({
      yelp: {
        rating: 4.2,
        review_count: 1200,
        price: "$$",
        categories: [],
        lat: 0,
        lng: 0,
      },
      google: {
        rating: 4.7,
        review_count: 120,
        place_id: null,
        maps_url: null,
      },
    });

    // Yelp dominates due to significantly higher review count.
    expect(score).toBeCloseTo(8.49, 2);
  });
});
