import { describe, expect, it } from "vitest";
import { formatReviewCount, getSortedRestaurants } from "../components/RestaurantTable";
import type { Restaurant } from "../lib/types";

function makeRestaurant(
  id: string,
  yelpReviews: number,
  yelpRating: number,
  googleReviews: number | null,
): Restaurant {
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
      rating: 4.2,
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
  const restaurants = [
    makeRestaurant("a", 20, 4.5, 300),
    makeRestaurant("b", 100, 4.2, null),
    makeRestaurant("c", 80, 4.8, 1200),
  ];

  it("defaults correctly for yelp review sort", () => {
    const sorted = getSortedRestaurants(restaurants, "yelp_reviews");
    expect(sorted.map((restaurant) => restaurant.id)).toEqual(["b", "c", "a"]);
  });

  it("sorts by yelp rating descending", () => {
    const sorted = getSortedRestaurants(restaurants, "yelp_rating");
    expect(sorted.map((restaurant) => restaurant.id)).toEqual(["c", "a", "b"]);
  });
});
