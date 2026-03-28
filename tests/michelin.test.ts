import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_MICHELIN_MATCH,
  getMichelinEntriesForCity,
  matchMichelinForRestaurant,
  resolveMichelinMatch,
} from "../lib/michelin";

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

  it("enforces strict <80m threshold boundary", () => {
    const thresholdCandidate = [
      {
        name: "Boundary",
        award: "Michelin Guide" as const,
        green_star: false,
        lat: 0,
        lng: 0,
      },
    ];

    const withinThreshold = resolveMichelinMatch(
      { lat: 0.00071, lng: 0 }, // ~79m from origin
      thresholdCandidate,
    );
    expect(withinThreshold.matched).toBe(true);

    const outsideThreshold = resolveMichelinMatch(
      { lat: 0.00072, lng: 0 }, // ~80m+ from origin
      thresholdCandidate,
    );
    expect(outsideThreshold).toEqual(EMPTY_MICHELIN_MATCH);
  });
});

describe("city lookup + runtime matcher", () => {
  it("normalizes city key casing and whitespace for lookup", () => {
    const compact = getMichelinEntriesForCity("san francisco");
    const padded = getMichelinEntriesForCity("  SAN   FRANCISCO  ");
    expect(padded).toEqual(compact);
  });

  it("normalizes city lookup against non-empty mocked Michelin data", async () => {
    vi.resetModules();
    vi.doMock("@/data/michelin.json", () => ({
      default: {
        cities: {
          "San   Francisco": [
            {
              name: "Mock Star Place",
              award: "1 Star",
              green_star: false,
              lat: 37.7749,
              lng: -122.4194,
            },
          ],
        },
      },
    }));

    const michelinModule = await import("../lib/michelin");
    const compact = michelinModule.getMichelinEntriesForCity("san francisco");
    const padded = michelinModule.getMichelinEntriesForCity("  SAN FRANCISCO ");

    expect(compact).toHaveLength(1);
    expect(padded).toEqual(compact);

    vi.doUnmock("@/data/michelin.json");
    vi.resetModules();
  });

  it("returns empty runtime match when city has no indexed entries", () => {
    const match = matchMichelinForRestaurant({
      city: "Unknown City",
      lat: 37.7749,
      lng: -122.4194,
    });
    expect(match).toEqual(EMPTY_MICHELIN_MATCH);
  });
});
