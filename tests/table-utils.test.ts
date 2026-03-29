import { describe, expect, it } from "vitest";
import { buildRestaurantsCsv, formatReviewCount, getSortedRestaurants } from "../components/RestaurantTable";
import type { Restaurant } from "../lib/types";

function makeRestaurant(
  id: string,
  overrides: {
    yelpReviews?: number;
    yelpRating?: number;
    googleRating?: number | null;
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
      rating: overrides.googleRating === undefined ? 4.2 : overrides.googleRating,
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

  it("sorts by total reviews descending using Yelp + Google", () => {
    const restaurants = [
      makeRestaurant("a", { yelpReviews: 200, googleReviews: 1000 }), // 1200
      makeRestaurant("b", { yelpReviews: 500, googleReviews: null }), // 500
      makeRestaurant("c", { yelpReviews: 300, googleReviews: 3000 }), // 3300
    ];
    const sorted = getSortedRestaurants(restaurants, "total_reviews");
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

  it("sorts by google rating descending with nulls last", () => {
    const restaurants = [
      makeRestaurant("a", { googleRating: 4.1 }),
      makeRestaurant("b", { googleRating: null }),
      makeRestaurant("c", { googleRating: 4.8 }),
    ];
    const sorted = getSortedRestaurants(restaurants, "google_rating");
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

  it("sorts mixed-source rows by Yelp reviews with Google-added rows last", () => {
    const restaurants = [
      makeRestaurant("yelp-1", { yelpReviews: 500 }),
      makeRestaurant("google-added", { yelpReviews: 0, yelpRating: 0, googleRating: 4.7, googleReviews: 3000 }),
      makeRestaurant("yelp-2", { yelpReviews: 1200 }),
    ];
    const sorted = getSortedRestaurants(restaurants, "yelp_reviews");
    expect(sorted.map((r) => r.id)).toEqual(["yelp-2", "yelp-1", "google-added"]);
  });

  it("sorts mixed-source rows by Google reviews with nulls last", () => {
    const restaurants = [
      makeRestaurant("google-rich", { googleReviews: 5000 }),
      makeRestaurant("google-mid", { googleReviews: 1200 }),
      makeRestaurant("google-null", { googleReviews: null }),
    ];
    const sorted = getSortedRestaurants(restaurants, "google_reviews");
    expect(sorted.map((r) => r.id)).toEqual(["google-rich", "google-mid", "google-null"]);
  });
});

describe("buildRestaurantsCsv", () => {
  it("includes header and rows with CSV escaping", () => {
    const restaurants = [
      makeRestaurant("a", {
        yelpReviews: 100,
        yelpRating: 4.3,
        googleRating: 4.5,
        googleReviews: 1200,
        combinedScore: 8.9,
      }),
      {
        ...makeRestaurant("b", {
          yelpReviews: 0,
          yelpRating: 0,
          googleRating: 4.6,
          googleReviews: 900,
          combinedScore: 9.2,
        }),
        name: "Comma, Quote \"Place\"",
      },
    ];

    const csv = buildRestaurantsCsv(restaurants, false);
    const lines = csv.split("\n");

    expect(lines[0]).toBe("Rank,Restaurant,Score,Total Reviews,Yelp Rating,Yelp Reviews,Google Rating,Google Reviews,Price,Cuisine,City,Google Maps URL");
    expect(lines[1]).toContain("1,Restaurant a,8.9,1300,4.3,100,4.5,1200");
    expect(lines[2]).toContain("2,\"Comma, Quote \"\"Place\"\"\",9.2,900,-,-,4.6,900,$$");
  });
});
