import { describe, expect, it } from "vitest";
import { formatReviewCount, getSortedRestaurants } from "../components/RestaurantTable";
import type { Restaurant } from "../lib/types";

function makeRestaurant(
  id: string,
  overrides: {
    yelpReviews?: number;
    yelpRating?: number;
    googleReviews?: number | null;
    combinedScore?: number | null;
    michelinAward?: "1 Star" | "2 Stars" | "3 Stars" | "Bib Gourmand" | "Michelin Guide" | null;
  } = {},
): Restaurant {
  return {
    id,
    name: `Restaurant ${id}`,
    city: "San Francisco",
    yelp: {
      rating: overrides.yelpRating ?? 4.0,
      review_count: overrides.yelpReviews ?? 100,
      price: "$$",
      categories: [],
      lat: 37.77,
      lng: -122.42,
    },
    google: {
      rating: 4.2,
      review_count: overrides.googleReviews ?? null,
      place_id: null,
      maps_url: null,
    },
    michelin: {
      award: overrides.michelinAward ?? null,
      green_star: false,
      matched: overrides.michelinAward !== null && overrides.michelinAward !== undefined,
    },
    combined_score: overrides.combinedScore ?? null,
  };
}

describe("formatReviewCount", () => {
  it("formats null as placeholder", () => {
    expect(formatReviewCount(null)).toBe("-");
  });

  it("formats plain counts under 1000", () => {
    expect(formatReviewCount(843)).toBe("843");
  });

  it("formats counts >= 1000 as compact k values", () => {
    expect(formatReviewCount(4200)).toBe("4.2k");
  });
});

describe("getSortedRestaurants", () => {
  it("sorts by yelp review count descending", () => {
    const restaurants = [
      makeRestaurant("a", { yelpReviews: 20 }),
      makeRestaurant("b", { yelpReviews: 100 }),
      makeRestaurant("c", { yelpReviews: 80 }),
    ];
    const sorted = getSortedRestaurants(restaurants, "yelp_reviews");
    expect(sorted.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("sorts by yelp rating descending", () => {
    const restaurants = [
      makeRestaurant("a", { yelpRating: 4.5 }),
      makeRestaurant("b", { yelpRating: 4.2 }),
      makeRestaurant("c", { yelpRating: 4.8 }),
    ];
    const sorted = getSortedRestaurants(restaurants, "yelp_rating");
    expect(sorted.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("sorts by combined score descending with nulls last", () => {
    const restaurants = [
      makeRestaurant("a", { combinedScore: 7.2 }),
      makeRestaurant("b", { combinedScore: null }),
      makeRestaurant("c", { combinedScore: 9.1 }),
    ];
    const sorted = getSortedRestaurants(restaurants, "combined_score");
    expect(sorted.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("sorts by google reviews descending with nulls last", () => {
    const restaurants = [
      makeRestaurant("a", { googleReviews: 300 }),
      makeRestaurant("b", { googleReviews: null }),
      makeRestaurant("c", { googleReviews: 1200 }),
    ];
    const sorted = getSortedRestaurants(restaurants, "google_reviews");
    expect(sorted.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("keeps stable order when all nullable values are null", () => {
    const restaurants = [
      makeRestaurant("a", { combinedScore: null }),
      makeRestaurant("b", { combinedScore: null }),
    ];
    const sorted = getSortedRestaurants(restaurants, "combined_score");
    expect(sorted.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
