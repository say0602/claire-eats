import { afterEach, describe, expect, it } from "vitest";
import { EnvValidationError, getServerEnv } from "../lib/env";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("getServerEnv", () => {
  it("returns keys when all required values are set", () => {
    process.env.YELP_API_KEY = "yelp-key";
    process.env.GOOGLE_MAPS_API_KEY = "google-key";

    expect(getServerEnv()).toEqual({
      YELP_API_KEY: "yelp-key",
      GOOGLE_MAPS_API_KEY: "google-key",
    });
  });

  it("throws a clear error when required values are missing", () => {
    delete process.env.YELP_API_KEY;
    process.env.GOOGLE_MAPS_API_KEY = "google-key";

    expect(() => getServerEnv()).toThrow(EnvValidationError);
    expect(() => getServerEnv()).toThrow(/YELP_API_KEY/);
  });
});
