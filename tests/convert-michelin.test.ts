import { describe, expect, it } from "vitest";
import { convertMichelinData, validateMichelinCityIndex } from "../scripts/convert-michelin";

describe("convertMichelinData", () => {
  it("converts valid source rows into city-indexed shape", () => {
    const converted = convertMichelinData([
      {
        Name: "Restaurant A",
        City: "San Francisco",
        Award: "1 Star",
        GreenStar: true,
        Latitude: 37.77,
        Longitude: -122.42,
      },
      {
        name: "Restaurant B",
        city: "San Francisco",
        award: "Bib Gourmand",
        green_star: false,
        lat: 37.78,
        lng: -122.43,
      },
    ]);

    expect(Object.keys(converted.cities)).toEqual(["san francisco"]);
    expect(converted.cities["san francisco"]).toHaveLength(2);
    expect(converted.cities["san francisco"][0]).toEqual({
      name: "Restaurant A",
      award: "1 Star",
      green_star: true,
      lat: 37.77,
      lng: -122.42,
    });
  });

  it("drops rows missing required fields", () => {
    const converted = convertMichelinData([
      {
        Name: "Missing Coordinates",
        City: "San Francisco",
        Award: "1 Star",
      },
      {
        Name: "Invalid Award",
        City: "San Francisco",
        Award: "Guide",
        Latitude: 37.77,
        Longitude: -122.42,
      },
    ]);

    expect(converted.cities).toEqual({});
  });
});

describe("validateMichelinCityIndex", () => {
  it("accepts valid converted shape", () => {
    const isValid = validateMichelinCityIndex({
      cities: {
        tokyo: [
          {
            name: "Restaurant C",
            award: "2 Stars",
            green_star: false,
            lat: 35.68,
            lng: 139.76,
          },
        ],
      },
    });

    expect(isValid).toBe(true);
  });

  it("rejects malformed city entries", () => {
    const isValid = validateMichelinCityIndex({
      cities: {
        tokyo: [{ name: "Broken", award: "2 Stars", green_star: "no", lat: 35.68, lng: 139.76 }],
      },
    });

    expect(isValid).toBe(false);
  });
});
