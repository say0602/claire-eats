import { describe, expect, it } from "vitest";
import { getDistanceMeters, hasNameOverlap, resolveGoogleEnrichment } from "../lib/matching";

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

describe("hasNameOverlap", () => {
  it("accepts when one normalized name includes the other", () => {
    expect(hasNameOverlap("Tartine Bakery", "Tartine")).toBe(true);
  });

  it("accepts when multiple tokens overlap", () => {
    expect(hasNameOverlap("State Bird Provisions", "State Bird")).toBe(true);
  });

  it("rejects unrelated names", () => {
    expect(hasNameOverlap("Chez Panisse", "Random Burger")).toBe(false);
  });
});

describe("resolveGoogleEnrichment", () => {
  const yelpRestaurant = {
    name: "Tartine Bakery",
    lat: 37.7615,
    lng: -122.4241,
  };

  it("accepts candidate by name overlap", () => {
    const enrichment = resolveGoogleEnrichment(yelpRestaurant, {
      name: "Tartine",
      lat: null,
      lng: null,
      rating: 4.6,
      user_ratings_total: 3200,
      place_id: "place-123",
    });

    expect(enrichment.rating).toBe(4.6);
    expect(enrichment.review_count).toBe(3200);
    expect(enrichment.maps_url).toContain("place_id:place-123");
  });

  it("accepts candidate by distance threshold", () => {
    const enrichment = resolveGoogleEnrichment(yelpRestaurant, {
      name: "Different Name",
      lat: 37.7618,
      lng: -122.4242,
      rating: 4.2,
      user_ratings_total: 200,
      place_id: "place-456",
    });

    expect(enrichment.place_id).toBe("place-456");
  });

  it("rejects candidate when no name overlap and no nearby coordinate", () => {
    const enrichment = resolveGoogleEnrichment(yelpRestaurant, {
      name: "Completely Different",
      lat: 37.8,
      lng: -122.5,
      rating: 4.9,
      user_ratings_total: 9999,
      place_id: "place-789",
    });

    expect(enrichment).toEqual({
      rating: null,
      review_count: null,
      place_id: null,
      maps_url: null,
    });
  });
});
