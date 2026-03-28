import { describe, expect, it } from "vitest";
import { EMPTY_MICHELIN_MATCH, resolveMichelinMatch } from "../lib/michelin";

describe("resolveMichelinMatch", () => {
  const candidates = [
    {
      name: "Near Match",
      award: "Bib Gourmand" as const,
      green_star: false,
      lat: 37.7749,
      lng: -122.4194,
    },
    {
      name: "Far Match",
      award: "1 Star" as const,
      green_star: true,
      lat: 37.8044,
      lng: -122.2712,
    },
  ];

  it("returns empty match when there are no city candidates", () => {
    expect(resolveMichelinMatch({ lat: 37.7749, lng: -122.4194 }, [])).toEqual(EMPTY_MICHELIN_MATCH);
  });

  it("returns nearest Michelin award when within threshold", () => {
    const match = resolveMichelinMatch({ lat: 37.77495, lng: -122.41945 }, candidates);
    expect(match).toEqual({
      award: "Bib Gourmand",
      green_star: false,
      matched: true,
    });
  });

  it("returns empty match when nearest candidate is too far away", () => {
    const match = resolveMichelinMatch({ lat: 37.7, lng: -122.5 }, candidates);
    expect(match).toEqual(EMPTY_MICHELIN_MATCH);
  });
});
