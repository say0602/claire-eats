import { afterEach, describe, expect, it } from "vitest";
import { GET } from "../app/api/config/route";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("GET /api/config", () => {
  it("returns ok=true when required env keys are present", async () => {
    process.env.YELP_API_KEY = "yelp-key";
    process.env.GOOGLE_MAPS_API_KEY = "google-key";

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
  });

  it("returns CONFIG_ERROR when env keys are missing", async () => {
    delete process.env.YELP_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("CONFIG_ERROR");
    expect(payload.error.message).toMatch(/YELP_API_KEY/);
    expect(payload.error.message).toMatch(/GOOGLE_MAPS_API_KEY/);
  });
});
