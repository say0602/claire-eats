import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as googlePost } from "../app/api/google/route";
import { POST as searchPost } from "../app/api/search/route";
import { POST as yelpPost } from "../app/api/yelp/route";

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  global.fetch = ORIGINAL_FETCH;
  process.env = { ...ORIGINAL_ENV };
});

describe("Phase 1 route guards", () => {
  it("returns INVALID_INPUT for Yelp when city is missing", async () => {
    const request = new Request("http://localhost/api/yelp", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    });

    const response = await yelpPost(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("INVALID_INPUT");
  });

  it("returns INVALID_INPUT for Google when required fields are missing", async () => {
    const request = new Request("http://localhost/api/google", {
      method: "POST",
      body: JSON.stringify({ city: "San Francisco" }),
      headers: { "content-type": "application/json" },
    });

    const response = await googlePost(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("INVALID_INPUT");
  });

  it("returns GOOGLE_RATE_LIMITED fallback when Google status is OVER_QUERY_LIMIT", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";

    const fetchMock = vi.fn(async () =>
      Response.json({
        status: "OVER_QUERY_LIMIT",
      }),
    );
    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/google", {
      method: "POST",
      body: JSON.stringify({ name: "A", city: "San Francisco" }),
      headers: { "content-type": "application/json" },
    });

    const response = await googlePost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("GOOGLE_RATE_LIMITED");
  });

  it("retries once on 5xx and returns success on second Google response", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";

    vi.spyOn(Math, "random").mockReturnValue(0);

    let attempt = 0;
    const fetchMock = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        return new Response("upstream failure", { status: 500 });
      }

      return Response.json({
        status: "OK",
        results: [
          {
            name: "Restaurant Alpha",
            rating: 4.7,
            user_ratings_total: 1000,
            place_id: "place-alpha",
            geometry: {
              location: {
                lat: 37.7749,
                lng: -122.4194,
              },
            },
          },
        ],
      });
    });
    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/google", {
      method: "POST",
      body: JSON.stringify({ name: "Restaurant Alpha", city: "San Francisco" }),
      headers: { "content-type": "application/json" },
    });

    const response = await googlePost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.google.place_id).toBe("place-alpha");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("normalizes Yelp results and filters rows missing coordinates", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";

    const fetchMock = vi.fn(async () =>
      Response.json({
        businesses: [
          {
            id: "valid-1",
            name: "Valid Restaurant",
            rating: 4.3,
            review_count: 180,
            price: "$$$",
            categories: [{ title: " Italian " }, { title: "Pasta" }],
            coordinates: { latitude: 37.77, longitude: -122.42 },
            location: {
              address1: "100 Test St",
              zip_code: "94103",
              display_address: ["100 Test St", "San Francisco, CA 94103"],
            },
          },
          {
            id: "invalid-1",
            name: "Missing Coordinates",
            rating: 4.8,
            review_count: 400,
            price: "$$",
            categories: [{ title: "French" }],
            coordinates: { latitude: 37.77 },
          },
        ],
      }),
    );
    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/yelp", {
      method: "POST",
      body: JSON.stringify({ city: "San Francisco" }),
      headers: { "content-type": "application/json" },
    });

    const response = await yelpPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.city).toBe("San Francisco");
    expect(payload.restaurants).toHaveLength(1);
    expect(payload.restaurants[0]).toEqual({
      id: "valid-1",
      name: "Valid Restaurant",
      city: "San Francisco",
      yelp: {
        rating: 4.3,
        review_count: 180,
        price: "$$$",
        categories: ["Italian", "Pasta"],
        lat: 37.77,
        lng: -122.42,
        address: "100 Test St, San Francisco, CA 94103",
        postal_code: "94103",
      },
    });
  });

  it("fetches top 50 Yelp rows sorted by review_count", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";

    const businesses = Array.from({ length: 50 }, (_, index) => ({
      id: `row-${index + 1}`,
      name: `Restaurant ${index + 1}`,
      rating: 4.0,
      review_count: 1000 - index,
      price: "$$",
      categories: [{ title: "Test" }],
      coordinates: { latitude: 37.7 + index * 0.0001, longitude: -122.4 },
      location: {
        address1: `${index + 1} Market St`,
        zip_code: "94103",
        display_address: [`${index + 1} Market St`, "San Francisco, CA 94103"],
      },
    }));

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("limit")).toBe("50");
      expect(url.searchParams.get("term")).toBe("restaurants");
      expect(url.searchParams.get("sort_by")).toBe("review_count");
      return Response.json({ businesses });
    });
    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/yelp", {
      method: "POST",
      body: JSON.stringify({ city: "San Francisco" }),
      headers: { "content-type": "application/json" },
    });

    const response = await yelpPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(payload.restaurants).toHaveLength(50);
    expect(payload.restaurants[0].yelp.review_count).toBeGreaterThanOrEqual(payload.restaurants[49].yelp.review_count);
  });

  it("uses location-biased query and picks best candidate from top results", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";

    const fetchMock = vi.fn(async () => {
      return Response.json({
        status: "OK",
        results: [
          {
            name: "Alpha Wrong Location",
            rating: 4.1,
            user_ratings_total: 150,
            place_id: "wrong-first",
            formatted_address: "1 Far Away Rd, San Francisco, CA 94105",
            geometry: { location: { lat: 37.79, lng: -122.48 } },
          },
          {
            name: "Restaurant Alpha",
            rating: 4.7,
            user_ratings_total: 1000,
            place_id: "best-second",
            formatted_address: "500 Howard St, San Francisco, CA 94105",
            geometry: { location: { lat: 37.789, lng: -122.394 } },
          },
        ],
      });
    });
    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/google", {
      method: "POST",
      body: JSON.stringify({
        name: "Restaurant Alpha",
        city: "San Francisco",
        lat: 37.789,
        lng: -122.394,
        address: "500 Howard St",
        postal_code: "94105",
      }),
      headers: { "content-type": "application/json" },
    });

    const response = await googlePost(request);
    const payload = await response.json();

    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl.searchParams.get("location")).toBe("37.789,-122.394");
    expect(requestUrl.searchParams.get("radius")).toBe("500");
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.google.place_id).toBe("best-second");
  });
});

describe("search orchestrator", () => {
  it("merges unique prominent rows in normal mode and dedupes overlaps", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        return Response.json({
          city: "San Francisco",
          restaurants: [
            {
              id: "y1",
              name: "Anchor Oyster Bar",
              city: "San Francisco",
              yelp: {
                rating: 4.4,
                review_count: 900,
                price: "$$",
                categories: ["Seafood"],
                lat: 37.7601,
                lng: -122.435,
              },
            },
            {
              id: "y2",
              name: "Tartine Bakery",
              city: "San Francisco",
              yelp: {
                rating: 4.5,
                review_count: 1200,
                price: "$$",
                categories: ["Bakery"],
                lat: 37.761,
                lng: -122.424,
              },
            },
          ],
        });
      }

      if (url.endsWith("/api/google")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          name?: string;
        };

        if (body.name === "Anchor Oyster Bar") {
          return Response.json({
            ok: true,
            google: {
              rating: 4.5,
              review_count: 5000,
              place_id: "anchor-place-id",
              maps_url: "https://www.google.com/maps/place/?q=place_id:anchor-place-id",
            },
          });
        }

        return Response.json({
          ok: true,
          google: {
            rating: 4.6,
            review_count: 7000,
            place_id: "tartine-place-id",
            maps_url: "https://www.google.com/maps/place/?q=place_id:tartine-place-id",
          },
        });
      }

      if (url.includes("places.googleapis.com/v1/places:searchText")) {
        return Response.json({
          places: [
            {
              id: "anchor-place-id",
              displayName: { text: "Anchor Oyster Bar" },
              userRating: 4.5,
              userRatingCount: 5100,
              location: { latitude: 37.7601, longitude: -122.435 },
              formattedAddress: "579 Castro St, San Francisco, CA",
              types: ["restaurant"],
            },
            {
              id: "another-place-id",
              displayName: { text: "Tartine Bakery" },
              userRating: 4.7,
              userRatingCount: 3000,
              location: { latitude: 37.76105, longitude: -122.42405 },
              formattedAddress: "600 Guerrero St, San Francisco, CA",
              types: ["restaurant"],
            },
            {
              id: "new-prominent-place-id",
              displayName: { text: "Unique Prominent Spot" },
              userRating: 4.8,
              userRatingCount: 4200,
              location: { latitude: 37.789, longitude: -122.401 },
              formattedAddress: "1 Embarcadero Ctr, San Francisco, CA",
              types: ["restaurant"],
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "San Francisco" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.google_only).toBeUndefined();
    expect(payload.warnings).toEqual([]);
    expect(payload.restaurants).toHaveLength(3);
    expect(payload.restaurants.map((restaurant: { name: string }) => restaurant.name)).toEqual([
      "Anchor Oyster Bar",
      "Tartine Bakery",
      "Unique Prominent Spot",
    ]);
  });

  it("backfills prominent additions from Yelp using normalized name and address signals", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        return Response.json({
          city: "San Francisco",
          restaurants: [
            {
              id: "y1",
              name: "Existing Yelp Row",
              city: "San Francisco",
              yelp: {
                rating: 4.5,
                review_count: 1200,
                price: "$$",
                categories: ["Seafood"],
                lat: 37.77,
                lng: -122.42,
              },
            },
          ],
        });
      }

      if (url.endsWith("/api/google")) {
        return Response.json({
          ok: true,
          google: {
            rating: 4.6,
            review_count: 800,
            place_id: "existing-google-place",
            maps_url: "https://www.google.com/maps/place/?q=place_id:existing-google-place",
          },
        });
      }

      if (url.includes("places.googleapis.com/v1/places:searchText")) {
        return Response.json({
          places: [
            {
              id: "prominent-poboys",
              displayName: { text: "PoBoys Kitchin" },
              rating: 4.7,
              userRatingCount: 900,
              location: { latitude: 37.781, longitude: -122.409 },
              formattedAddress: "175 2nd St, San Francisco, CA 94105",
              types: ["restaurant"],
            },
          ],
        });
      }

      if (url.includes("api.yelp.com/v3/businesses/search")) {
        const requestUrl = new URL(url);
        expect(requestUrl.searchParams.get("term")).toBe("PoBoys Kitchin");
        expect(requestUrl.searchParams.get("latitude")).toBe("37.781");
        expect(requestUrl.searchParams.get("longitude")).toBe("-122.409");

        return Response.json({
          businesses: [
            {
              name: "Po'Boys Kitchin",
              rating: 4.4,
              review_count: 321,
              price: "$$",
              categories: [{ title: "Cajun/Creole" }],
              coordinates: { latitude: 37.7811, longitude: -122.4092 },
              location: {
                address1: "175 2nd St",
                zip_code: "94105",
                display_address: ["175 2nd St", "San Francisco, CA 94105"],
              },
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "San Francisco" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    const prominentRow = payload.restaurants.find((restaurant: { name: string }) => restaurant.name === "PoBoys Kitchin");
    expect(prominentRow).toBeTruthy();
    expect(prominentRow.yelp.rating).toBe(4.4);
    expect(prominentRow.yelp.review_count).toBe(321);
    expect(prominentRow.yelp.address).toBe("175 2nd St, San Francisco, CA 94105");
  });

  it("retries prominent Yelp backfill once on 429", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";

    let backfillLookupAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        return Response.json({
          city: "San Francisco",
          restaurants: [
            {
              id: "y1",
              name: "Existing Yelp Row",
              city: "San Francisco",
              yelp: {
                rating: 4.5,
                review_count: 1200,
                price: "$$",
                categories: ["Seafood"],
                lat: 37.77,
                lng: -122.42,
              },
            },
          ],
        });
      }

      if (url.endsWith("/api/google")) {
        return Response.json({
          ok: true,
          google: {
            rating: 4.6,
            review_count: 800,
            place_id: "existing-google-place",
            maps_url: "https://www.google.com/maps/place/?q=place_id:existing-google-place",
          },
        });
      }

      if (url.includes("places.googleapis.com/v1/places:searchText")) {
        return Response.json({
          places: [
            {
              id: "prominent-poboys",
              displayName: { text: "PoBoys Kitchin" },
              rating: 4.7,
              userRatingCount: 900,
              location: { latitude: 37.781, longitude: -122.409 },
              formattedAddress: "175 2nd St, San Francisco, CA 94105",
              types: ["restaurant"],
            },
          ],
        });
      }

      if (url.includes("api.yelp.com/v3/businesses/search")) {
        backfillLookupAttempts += 1;
        if (backfillLookupAttempts === 1) {
          return new Response(
            JSON.stringify({
              error: { code: "TOO_MANY_REQUESTS_PER_SECOND", description: "Rate limit exceeded" },
            }),
            { status: 429, headers: { "content-type": "application/json" } },
          );
        }

        return Response.json({
          businesses: [
            {
              name: "Po'Boys Kitchin",
              rating: 4.4,
              review_count: 321,
              price: "$$",
              categories: [{ title: "Cajun/Creole" }],
              coordinates: { latitude: 37.7811, longitude: -122.4092 },
              location: {
                address1: "175 2nd St",
                zip_code: "94105",
                display_address: ["175 2nd St", "San Francisco, CA 94105"],
              },
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "San Francisco" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    const prominentRow = payload.restaurants.find((restaurant: { name: string }) => restaurant.name === "PoBoys Kitchin");
    expect(prominentRow).toBeTruthy();
    expect(prominentRow.yelp.rating).toBe(4.4);
    expect(prominentRow.yelp.review_count).toBe(321);
    expect(backfillLookupAttempts).toBe(2);
  });

  it("stops prominent Yelp backfill when budget is exhausted and reports degraded budget mode", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    process.env.APP_PROFILE = "public";
    process.env.NEXT_PUBLIC_APP_PROFILE = "public";
    process.env.YELP_PROMINENT_BACKFILL_BUDGET_MS = "0";
    process.env.SEARCH_SNAPSHOT_PUBLIC_ENABLED = "0";
    process.env.SEARCH_DIAGNOSTICS_ENABLED = "1";
    const diagnosticsSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    let backfillLookupAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        return Response.json({
          city: "San Francisco",
          restaurants: [
            {
              id: "y1",
              name: "Existing Yelp Row",
              city: "San Francisco",
              yelp: {
                rating: 4.5,
                review_count: 1200,
                price: "$$",
                categories: ["Seafood"],
                lat: 37.77,
                lng: -122.42,
              },
            },
          ],
        });
      }

      if (url.endsWith("/api/google")) {
        return Response.json({
          ok: true,
          google: {
            rating: 4.6,
            review_count: 800,
            place_id: "existing-google-place",
            maps_url: "https://www.google.com/maps/place/?q=place_id:existing-google-place",
          },
        });
      }

      if (url.includes("places.googleapis.com/v1/places:searchText")) {
        return Response.json({
          places: [
            {
              id: "prominent-budget-test",
              displayName: { text: "Budget Test Restaurant" },
              rating: 4.7,
              userRatingCount: 900,
              location: { latitude: 37.701, longitude: -122.501 },
              formattedAddress: "500 Ocean Ave, San Francisco, CA 94112",
              types: ["restaurant"],
            },
          ],
        });
      }

      if (url.includes("api.yelp.com/v3/businesses/search")) {
        backfillLookupAttempts += 1;
        return Response.json({
          businesses: [
            {
              name: "Budget Test Restaurant",
              rating: 4.4,
              review_count: 321,
              price: "$$",
              categories: [{ title: "Cajun/Creole" }],
              coordinates: { latitude: 37.7811, longitude: -122.4092 },
              location: {
                address1: "175 2nd St",
                zip_code: "94105",
                display_address: ["175 2nd St", "San Francisco, CA 94105"],
              },
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "San Francisco" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    const prominentRow = payload.restaurants.find((restaurant: { name: string }) => restaurant.name === "Budget Test Restaurant");
    expect(prominentRow).toBeTruthy();
    expect(prominentRow.yelp.review_count).toBe(0);
    expect(backfillLookupAttempts).toBe(0);

    expect(diagnosticsSpy).toHaveBeenCalledWith(
      "[search-diagnostics]",
      expect.objectContaining({
        mode: "yelp_primary",
        yelp_backfill_attempted: 0,
        yelp_backfill_matched: 0,
        yelp_backfill_skipped_budget: 1,
        yelp_backfill_skipped_time_budget: 1,
        request_budget_mode: "degraded",
      }),
    );
  });

  it("applies public-profile prominent lookup cap", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    process.env.APP_PROFILE = "public";
    process.env.NEXT_PUBLIC_APP_PROFILE = "public";
    process.env.SEARCH_SNAPSHOT_PUBLIC_ENABLED = "0";
    process.env.YELP_PROMINENT_LOOKUP_LIMIT_PUBLIC = "1";
    process.env.SEARCH_DIAGNOSTICS_ENABLED = "1";
    const diagnosticsSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    let backfillLookupAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        return Response.json({
          city: "San Francisco",
          restaurants: [
            {
              id: "y1",
              name: "Existing Yelp Row",
              city: "San Francisco",
              yelp: {
                rating: 4.5,
                review_count: 1200,
                price: "$$",
                categories: ["Seafood"],
                lat: 37.77,
                lng: -122.42,
              },
            },
          ],
        });
      }

      if (url.endsWith("/api/google")) {
        return Response.json({
          ok: true,
          google: {
            rating: 4.6,
            review_count: 800,
            place_id: "existing-google-place",
            maps_url: "https://www.google.com/maps/place/?q=place_id:existing-google-place",
          },
        });
      }

      if (url.includes("places.googleapis.com/v1/places:searchText")) {
        return Response.json({
          places: [
            {
              id: "prominent-cap-1",
              displayName: { text: "Cap Test One" },
              rating: 4.7,
              userRatingCount: 900,
              location: { latitude: 37.701, longitude: -122.501 },
              formattedAddress: "500 Ocean Ave, San Francisco, CA 94112",
              types: ["restaurant"],
            },
            {
              id: "prominent-cap-2",
              displayName: { text: "Cap Test Two" },
              rating: 4.5,
              userRatingCount: 700,
              location: { latitude: 37.702, longitude: -122.502 },
              formattedAddress: "501 Ocean Ave, San Francisco, CA 94112",
              types: ["restaurant"],
            },
          ],
        });
      }

      if (url.includes("api.yelp.com/v3/businesses/search")) {
        backfillLookupAttempts += 1;
        return Response.json({ businesses: [] });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "San Francisco" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    expect(response.status).toBe(200);
    expect(backfillLookupAttempts).toBe(1);

    expect(diagnosticsSpy).toHaveBeenCalledWith(
      "[search-diagnostics]",
      expect.objectContaining({
        mode: "yelp_primary",
        yelp_backfill_attempted: 1,
        yelp_backfill_skipped_lookup_cap: 1,
        yelp_backfill_skipped_budget: 1,
        request_budget_mode: "normal",
      }),
    );
  });

  it("does not apply public-profile lookup cap when server profile is private", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    process.env.APP_PROFILE = "private";
    process.env.NEXT_PUBLIC_APP_PROFILE = "private";
    process.env.SEARCH_SNAPSHOT_PUBLIC_ENABLED = "0";
    process.env.YELP_PROMINENT_LOOKUP_LIMIT_PUBLIC = "1";
    process.env.SEARCH_DIAGNOSTICS_ENABLED = "1";
    const diagnosticsSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    let backfillLookupAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        return Response.json({
          city: "San Francisco",
          restaurants: [
            {
              id: "y1",
              name: "Existing Yelp Row",
              city: "San Francisco",
              yelp: {
                rating: 4.5,
                review_count: 1200,
                price: "$$",
                categories: ["Seafood"],
                lat: 37.77,
                lng: -122.42,
              },
            },
          ],
        });
      }

      if (url.endsWith("/api/google")) {
        return Response.json({
          ok: true,
          google: {
            rating: 4.6,
            review_count: 800,
            place_id: "existing-google-place",
            maps_url: "https://www.google.com/maps/place/?q=place_id:existing-google-place",
          },
        });
      }

      if (url.includes("places.googleapis.com/v1/places:searchText")) {
        return Response.json({
          places: [
            {
              id: "prominent-private-cap-1",
              displayName: { text: "Private Cap One" },
              rating: 4.7,
              userRatingCount: 900,
              location: { latitude: 37.701, longitude: -122.501 },
              formattedAddress: "500 Ocean Ave, San Francisco, CA 94112",
              types: ["restaurant"],
            },
            {
              id: "prominent-private-cap-2",
              displayName: { text: "Private Cap Two" },
              rating: 4.5,
              userRatingCount: 700,
              location: { latitude: 37.702, longitude: -122.502 },
              formattedAddress: "501 Ocean Ave, San Francisco, CA 94112",
              types: ["restaurant"],
            },
          ],
        });
      }

      if (url.includes("api.yelp.com/v3/businesses/search")) {
        backfillLookupAttempts += 1;
        return Response.json({ businesses: [] });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "San Francisco" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    expect(response.status).toBe(200);
    expect(backfillLookupAttempts).toBe(2);

    expect(diagnosticsSpy).toHaveBeenCalledWith(
      "[search-diagnostics]",
      expect.objectContaining({
        mode: "yelp_primary",
        yelp_backfill_attempted: 2,
        yelp_backfill_skipped_lookup_cap: 0,
      }),
    );
  });

  it("stops backfill after at least one attempt when time budget is exceeded", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    process.env.APP_PROFILE = "public";
    process.env.NEXT_PUBLIC_APP_PROFILE = "public";
    process.env.SEARCH_SNAPSHOT_PUBLIC_ENABLED = "0";
    process.env.YELP_PROMINENT_BACKFILL_BUDGET_MS = "10";
    process.env.SEARCH_DIAGNOSTICS_ENABLED = "1";
    const diagnosticsSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    let nowMs = 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);

    let backfillLookupAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        return Response.json({
          city: "San Francisco",
          restaurants: [
            {
              id: "y1",
              name: "Existing Yelp Row",
              city: "San Francisco",
              yelp: {
                rating: 4.5,
                review_count: 1200,
                price: "$$",
                categories: ["Seafood"],
                lat: 37.77,
                lng: -122.42,
              },
            },
          ],
        });
      }

      if (url.endsWith("/api/google")) {
        return Response.json({
          ok: true,
          google: {
            rating: 4.6,
            review_count: 800,
            place_id: "existing-google-place",
            maps_url: "https://www.google.com/maps/place/?q=place_id:existing-google-place",
          },
        });
      }

      if (url.includes("places.googleapis.com/v1/places:searchText")) {
        return Response.json({
          places: [
            {
              id: "prominent-budget-partial-1",
              displayName: { text: "Budget Partial One" },
              rating: 4.7,
              userRatingCount: 900,
              location: { latitude: 37.701, longitude: -122.501 },
              formattedAddress: "500 Ocean Ave, San Francisco, CA 94112",
              types: ["restaurant"],
            },
            {
              id: "prominent-budget-partial-2",
              displayName: { text: "Budget Partial Two" },
              rating: 4.5,
              userRatingCount: 700,
              location: { latitude: 37.702, longitude: -122.502 },
              formattedAddress: "501 Ocean Ave, San Francisco, CA 94112",
              types: ["restaurant"],
            },
          ],
        });
      }

      if (url.includes("api.yelp.com/v3/businesses/search")) {
        backfillLookupAttempts += 1;
        if (backfillLookupAttempts === 1) {
          nowMs += 20;
        }
        return Response.json({ businesses: [] });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "San Francisco" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    expect(response.status).toBe(200);
    expect(backfillLookupAttempts).toBe(1);

    expect(diagnosticsSpy).toHaveBeenCalledWith(
      "[search-diagnostics]",
      expect.objectContaining({
        mode: "yelp_primary",
        yelp_backfill_attempted: 1,
        yelp_backfill_skipped_time_budget: 1,
        yelp_backfill_skipped_budget: 1,
        request_budget_mode: "degraded",
      }),
    );
  });

  it("serves from dynamic city cache when available", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    process.env.APP_PROFILE = "private";
    process.env.NEXT_PUBLIC_APP_PROFILE = "private";
    process.env.SEARCH_SNAPSHOT_PUBLIC_ENABLED = "0";
    process.env.SEARCH_DYNAMIC_CITY_CACHE_ENABLED = "1";
    process.env.SEARCH_DYNAMIC_CITY_CACHE_VERSION = "test-cache-read-path-v1";
    process.env.SEARCH_DYNAMIC_CITY_CACHE_TTL_COLD_MINUTES = "60";
    process.env.SEARCH_DIAGNOSTICS_ENABLED = "1";
    const diagnosticsSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    let yelpCalls = 0;
    let googleCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        yelpCalls += 1;
        return Response.json({
          city: "Cache City",
          restaurants: [
            {
              id: "y1",
              name: "Cached Candidate",
              city: "Cache City",
              yelp: {
                rating: 4.6,
                review_count: 600,
                price: "$$",
                categories: ["Test"],
                lat: 37.77,
                lng: -122.42,
              },
            },
          ],
        });
      }

      if (url.endsWith("/api/google")) {
        googleCalls += 1;
        return Response.json({
          ok: true,
          google: {
            rating: 4.5,
            review_count: 400,
            place_id: "cache-google-1",
            maps_url: "https://www.google.com/maps/place/?q=place_id:cache-google-1",
          },
        });
      }

      if (url.includes("places.googleapis.com/v1/places:searchText")) {
        return Response.json({ places: [] });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    const buildRequest = () => new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "Cache City" }),
      headers: { "content-type": "application/json" },
    });

    const firstResponse = await searchPost(buildRequest());
    const firstPayload = await firstResponse.json();
    expect(firstResponse.status).toBe(200);
    expect(firstPayload.restaurants).toHaveLength(1);
    expect(yelpCalls).toBe(1);
    expect(googleCalls).toBe(1);

    const secondResponse = await searchPost(buildRequest());
    const secondPayload = await secondResponse.json();
    expect(secondResponse.status).toBe(200);
    expect(secondPayload.restaurants).toHaveLength(1);
    expect(yelpCalls).toBe(1);
    expect(googleCalls).toBe(1);

    const diagnosticsPayloads = diagnosticsSpy.mock.calls
      .filter(([marker]) => marker === "[search-diagnostics]")
      .map(([, payload]) => payload as Record<string, unknown>);
    const primaryDiagnostic = diagnosticsPayloads.find((entry) => entry.mode === "yelp_primary");
    const cacheDiagnostic = diagnosticsPayloads.find((entry) => entry.mode === "cache");

    expect(primaryDiagnostic).toEqual(expect.objectContaining({
      cache_hit: false,
      cache_write: true,
      cache_write_skipped_reason: null,
      cache_ttl_minutes: expect.any(Number),
    }));
    expect(cacheDiagnostic).toEqual(expect.objectContaining({
      cache_hit: true,
      cache_write: false,
      cache_write_skipped_reason: null,
      cache_ttl_minutes: null,
    }));
  });

  it("uses profile-aware cache key so private and public caches do not collide", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    process.env.SEARCH_SNAPSHOT_PUBLIC_ENABLED = "0";
    process.env.SEARCH_DYNAMIC_CITY_CACHE_ENABLED = "1";
    process.env.SEARCH_DYNAMIC_CITY_CACHE_VERSION = "test-cache-profile-key-v1";
    process.env.SEARCH_DYNAMIC_CITY_CACHE_TTL_COLD_MINUTES = "60";

    let yelpCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        yelpCalls += 1;
        return Response.json({
          city: "Profile Cache City",
          restaurants: [
            {
              id: "y1",
              name: "Profile Candidate",
              city: "Profile Cache City",
              yelp: {
                rating: 4.6,
                review_count: 600,
                price: "$$",
                categories: ["Test"],
                lat: 37.77,
                lng: -122.42,
              },
            },
          ],
        });
      }

      if (url.endsWith("/api/google")) {
        return Response.json({
          ok: true,
          google: {
            rating: 4.5,
            review_count: 400,
            place_id: "profile-google-1",
            maps_url: "https://www.google.com/maps/place/?q=place_id:profile-google-1",
          },
        });
      }

      if (url.includes("places.googleapis.com/v1/places:searchText")) {
        return Response.json({ places: [] });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    process.env.APP_PROFILE = "private";
    process.env.NEXT_PUBLIC_APP_PROFILE = "private";
    const privateRequest = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "Profile Cache City" }),
      headers: { "content-type": "application/json" },
    });
    const privateResponse = await searchPost(privateRequest);
    expect(privateResponse.status).toBe(200);

    process.env.APP_PROFILE = "public";
    process.env.NEXT_PUBLIC_APP_PROFILE = "public";
    const publicRequest = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "Profile Cache City" }),
      headers: { "content-type": "application/json" },
    });
    const publicResponse = await searchPost(publicRequest);
    expect(publicResponse.status).toBe(200);

    expect(yelpCalls).toBe(2);
  });

  it("does not serve expired dynamic city cache entries", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    process.env.APP_PROFILE = "private";
    process.env.NEXT_PUBLIC_APP_PROFILE = "private";
    process.env.SEARCH_SNAPSHOT_PUBLIC_ENABLED = "0";
    process.env.SEARCH_DYNAMIC_CITY_CACHE_ENABLED = "1";
    process.env.SEARCH_DYNAMIC_CITY_CACHE_VERSION = "test-cache-expiry-v1";
    process.env.SEARCH_DYNAMIC_CITY_CACHE_TTL_COLD_MINUTES = "0";

    let yelpCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        yelpCalls += 1;
        return Response.json({
          city: "Expiry City",
          restaurants: [
            {
              id: `y-${yelpCalls}`,
              name: `Expiry Candidate ${yelpCalls}`,
              city: "Expiry City",
              yelp: {
                rating: 4.6,
                review_count: 600,
                price: "$$",
                categories: ["Test"],
                lat: 37.77,
                lng: -122.42,
              },
            },
          ],
        });
      }

      if (url.endsWith("/api/google")) {
        return Response.json({
          ok: true,
          google: {
            rating: 4.5,
            review_count: 400,
            place_id: "expiry-google-1",
            maps_url: "https://www.google.com/maps/place/?q=place_id:expiry-google-1",
          },
        });
      }

      if (url.includes("places.googleapis.com/v1/places:searchText")) {
        return Response.json({ places: [] });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    const buildRequest = () => new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "Expiry City" }),
      headers: { "content-type": "application/json" },
    });

    const firstResponse = await searchPost(buildRequest());
    expect(firstResponse.status).toBe(200);
    const secondResponse = await searchPost(buildRequest());
    expect(secondResponse.status).toBe(200);

    expect(yelpCalls).toBe(2);
  });

  it("writes and serves cache for live google-only fallback responses", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    process.env.APP_PROFILE = "private";
    process.env.NEXT_PUBLIC_APP_PROFILE = "private";
    process.env.SEARCH_SNAPSHOT_PUBLIC_ENABLED = "0";
    process.env.SEARCH_DYNAMIC_CITY_CACHE_ENABLED = "1";
    process.env.SEARCH_DYNAMIC_CITY_CACHE_VERSION = "test-cache-fallback-write-v1";
    process.env.SEARCH_DYNAMIC_CITY_CACHE_TTL_COLD_MINUTES = "60";

    let yelpCalls = 0;
    let prominentCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        yelpCalls += 1;
        return Response.json({
          city: "Fallback Cache City",
          restaurants: [],
        });
      }

      if (url.includes("places.googleapis.com/v1/places:searchText")) {
        prominentCalls += 1;
        return Response.json({
          places: [
            {
              id: "fallback-cache-1",
              displayName: { text: "Fallback Cached Restaurant" },
              rating: 4.5,
              userRatingCount: 850,
              location: { latitude: 37.781, longitude: -122.409 },
              formattedAddress: "175 2nd St, San Francisco, CA 94105",
              types: ["restaurant"],
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    const buildRequest = () => new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "Fallback Cache City" }),
      headers: { "content-type": "application/json" },
    });

    const firstResponse = await searchPost(buildRequest());
    const firstPayload = await firstResponse.json();
    expect(firstResponse.status).toBe(200);
    expect(firstPayload.google_only).toBe(true);
    expect(firstPayload.restaurants.length).toBeGreaterThan(0);
    expect(yelpCalls).toBe(1);
    expect(prominentCalls).toBe(1);

    const secondResponse = await searchPost(buildRequest());
    const secondPayload = await secondResponse.json();
    expect(secondResponse.status).toBe(200);
    expect(secondPayload.google_only).toBe(true);
    expect(secondPayload.restaurants.length).toBeGreaterThan(0);
    expect(yelpCalls).toBe(1);
    expect(prominentCalls).toBe(1);
  });

  it("does not cache degraded google-only fallback responses", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    process.env.APP_PROFILE = "private";
    process.env.NEXT_PUBLIC_APP_PROFILE = "private";
    process.env.SEARCH_SNAPSHOT_PUBLIC_ENABLED = "0";
    process.env.SEARCH_DYNAMIC_CITY_CACHE_ENABLED = "1";
    process.env.SEARCH_DYNAMIC_CITY_CACHE_VERSION = "test-cache-fallback-degraded-v1";
    process.env.SEARCH_DYNAMIC_CITY_CACHE_TTL_COLD_MINUTES = "60";
    process.env.SEARCH_DIAGNOSTICS_ENABLED = "1";
    const diagnosticsSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    let yelpCalls = 0;
    let legacyFallbackCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        yelpCalls += 1;
        return Response.json({
          city: "Fallback Degraded City",
          restaurants: [],
        });
      }

      if (url.includes("places.googleapis.com/v1/places:searchText")) {
        return new Response("upstream error", { status: 500 });
      }

      if (url.includes("maps.googleapis.com/maps/api/place/textsearch/json")) {
        legacyFallbackCalls += 1;
        return new Response("upstream error", { status: 500 });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    const buildRequest = () => new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "Fallback Degraded City" }),
      headers: { "content-type": "application/json" },
    });

    const firstResponse = await searchPost(buildRequest());
    const firstPayload = await firstResponse.json();
    expect(firstResponse.status).toBe(200);
    expect(firstPayload.google_only).toBe(true);
    expect(firstPayload.warnings).toEqual([
      { code: "GOOGLE_UPSTREAM_ERROR", message: "Google fallback search failed." },
    ]);

    const secondResponse = await searchPost(buildRequest());
    const secondPayload = await secondResponse.json();
    expect(secondResponse.status).toBe(200);
    expect(secondPayload.google_only).toBe(true);
    expect(secondPayload.warnings).toEqual([
      { code: "GOOGLE_UPSTREAM_ERROR", message: "Google fallback search failed." },
    ]);

    expect(yelpCalls).toBe(2);
    expect(legacyFallbackCalls).toBe(2);

    const diagnosticsPayloads = diagnosticsSpy.mock.calls
      .filter(([marker]) => marker === "[search-diagnostics]")
      .map(([, payload]) => payload as Record<string, unknown>);
    const fallbackDiagnostic = diagnosticsPayloads.find((entry) => entry.mode === "google_fallback");
    expect(fallbackDiagnostic).toEqual(expect.objectContaining({
      cache_hit: false,
      cache_write: false,
      cache_write_skipped_reason: "warnings",
      cache_ttl_minutes: null,
    }));
  });

  it("prunes cache to max entries and evicts oldest key", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    process.env.APP_PROFILE = "private";
    process.env.NEXT_PUBLIC_APP_PROFILE = "private";
    process.env.SEARCH_SNAPSHOT_PUBLIC_ENABLED = "0";
    process.env.SEARCH_DYNAMIC_CITY_CACHE_ENABLED = "1";
    process.env.SEARCH_DYNAMIC_CITY_CACHE_VERSION = "test-cache-max-entries-v1";
    process.env.SEARCH_DYNAMIC_CITY_CACHE_TTL_COLD_MINUTES = "60";
    process.env.SEARCH_DYNAMIC_CITY_CACHE_MAX_ENTRIES = "1";

    let yelpCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        yelpCalls += 1;
        const city = yelpCalls === 1 ? "City A" : yelpCalls === 2 ? "City B" : "City A";
        return Response.json({
          city,
          restaurants: [
            {
              id: `y-${yelpCalls}`,
              name: `Cache Candidate ${city}`,
              city,
              yelp: {
                rating: 4.6,
                review_count: 600,
                price: "$$",
                categories: ["Test"],
                lat: 37.77,
                lng: -122.42,
              },
            },
          ],
        });
      }

      if (url.endsWith("/api/google")) {
        return Response.json({
          ok: true,
          google: {
            rating: 4.5,
            review_count: 400,
            place_id: `max-entries-google-${yelpCalls}`,
            maps_url: `https://www.google.com/maps/place/?q=place_id:max-entries-google-${yelpCalls}`,
          },
        });
      }

      if (url.includes("places.googleapis.com/v1/places:searchText")) {
        return Response.json({ places: [] });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    const buildRequest = (city: string) => new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city }),
      headers: { "content-type": "application/json" },
    });

    const firstCityA = await searchPost(buildRequest("City A"));
    expect(firstCityA.status).toBe(200);
    const cityB = await searchPost(buildRequest("City B"));
    expect(cityB.status).toBe(200);
    const secondCityA = await searchPost(buildRequest("City A"));
    expect(secondCityA.status).toBe(200);

    expect(yelpCalls).toBe(3);
  });

  it("caps normal-mode merged output at 80 rows", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";

    const yelpRows = Array.from({ length: 50 }, (_, index) => ({
      id: `y${index + 1}`,
      name: `Yelp Restaurant ${index + 1}`,
      city: "San Francisco",
      yelp: {
        rating: 4.0,
        review_count: 10_000 - index,
        price: "$$",
        categories: ["Test"],
        lat: 37.75 + index * 0.001,
        lng: -122.45 + index * 0.001,
      },
    }));
    const prominentPlaces = Array.from({ length: 60 }, (_, index) => ({
      id: `prominent-${index + 1}`,
      displayName: { text: `Prominent Restaurant ${index + 1}` },
      userRating: 4.6,
      userRatingCount: 2000 + index,
      location: { latitude: 37.9 + index * 0.001, longitude: -122.2 + index * 0.001 },
      formattedAddress: `${index + 1} Prominent Ave, San Francisco, CA`,
      types: ["restaurant"],
    }));

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        return Response.json({ city: "San Francisco", restaurants: yelpRows });
      }

      if (url.endsWith("/api/google")) {
        return Response.json({
          ok: true,
          google: {
            rating: 4.4,
            review_count: 1000,
            place_id: null,
            maps_url: null,
          },
        });
      }

      if (url.includes("places.googleapis.com/v1/places:searchText")) {
        return Response.json({ places: prominentPlaces });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "San Francisco" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.google_only).toBeUndefined();
    expect(payload.restaurants).toHaveLength(80);
    expect(payload.restaurants[0].name).toBe("Yelp Restaurant 1");
    expect(payload.restaurants[79].name).toBe("Prominent Restaurant 30");
  });

  it("keeps normal-mode warnings focused on Yelp enrichment when prominent fetch fails", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        return Response.json({
          city: "San Francisco",
          restaurants: [
            {
              id: "y1",
              name: "Primary Yelp Row",
              city: "San Francisco",
              yelp: {
                rating: 4.5,
                review_count: 2000,
                price: "$$",
                categories: ["American"],
                lat: 37.77,
                lng: -122.42,
              },
            },
          ],
        });
      }

      if (url.endsWith("/api/google")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { name?: string };
        expect(body.name).toBe("Primary Yelp Row");
        return Response.json({
          ok: true,
          google: {
            rating: 4.6,
            review_count: 500,
            place_id: "primary-google-place",
            maps_url: "https://www.google.com/maps/place/?q=place_id:primary-google-place",
          },
        });
      }

      if (url.includes("places.googleapis.com/v1/places:searchText")) {
        return new Response("upstream error", { status: 500 });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "San Francisco" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.google_only).toBeUndefined();
    expect(payload.restaurants).toHaveLength(1);
    expect(payload.restaurants[0].name).toBe("Primary Yelp Row");
    expect(payload.warnings).toEqual([]);
  });

  it("dedupes repeated prominent rows before appending merged additions", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        return Response.json({
          city: "San Francisco",
          restaurants: [
            {
              id: "y1",
              name: "Yelp Anchor",
              city: "San Francisco",
              yelp: {
                rating: 4.5,
                review_count: 1000,
                price: "$$",
                categories: ["Seafood"],
                lat: 37.77,
                lng: -122.42,
              },
            },
          ],
        });
      }

      if (url.endsWith("/api/google")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { name?: string };
        expect(body.name).toBe("Yelp Anchor");
        return Response.json({
          ok: true,
          google: {
            rating: 4.7,
            review_count: 800,
            place_id: "yelp-anchor-google",
            maps_url: "https://www.google.com/maps/place/?q=place_id:yelp-anchor-google",
          },
        });
      }

      if (url.includes("places.googleapis.com/v1/places:searchText")) {
        return Response.json({
          places: [
            {
              id: "prominent-dup-1",
              displayName: { text: "Repeated Prominent" },
              userRating: 4.8,
              userRatingCount: 2000,
              location: { latitude: 37.79, longitude: -122.41 },
              types: ["restaurant"],
            },
            {
              id: "prominent-dup-2",
              displayName: { text: "Repeated Prominent" },
              userRating: 4.8,
              userRatingCount: 2000,
              location: { latitude: 37.79, longitude: -122.41 },
              types: ["restaurant"],
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "San Francisco" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.google_only).toBeUndefined();
    expect(payload.restaurants).toHaveLength(2);
    expect(payload.warnings).toEqual([]);
    expect(payload.restaurants.map((r: { name: string }) => r.name)).toEqual([
      "Yelp Anchor",
      "Repeated Prominent",
    ]);
  });

  it("returns partial enrichment warnings while preserving Yelp rows", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        return Response.json({
          city: "San Francisco",
          restaurants: [
            {
              id: "y1",
              name: "Restaurant One",
              city: "San Francisco",
              yelp: {
                rating: 4.5,
                review_count: 200,
                price: "$$",
                categories: ["American"],
                lat: 37.77,
                lng: -122.42,
              },
            },
            {
              id: "y2",
              name: "Restaurant Two",
              city: "San Francisco",
              yelp: {
                rating: 4.2,
                review_count: 120,
                price: "$",
                categories: ["Thai"],
                lat: 37.78,
                lng: -122.41,
              },
            },
          ],
        });
      }

      if (url.endsWith("/api/google")) {
        const callCount = fetchMock.mock.calls.filter(([arg]) => String(arg).endsWith("/api/google")).length;
        if (callCount === 1) {
          return Response.json({
            ok: true,
            google: {
              rating: 4.6,
              review_count: 220,
              place_id: "place-1",
              maps_url: "https://www.google.com/maps/place/?q=place_id:place-1",
            },
          });
        }

        return Response.json({
          ok: false,
          code: "GOOGLE_TIMEOUT",
          message: "Google request timed out.",
          google: {
            rating: null,
            review_count: null,
            place_id: null,
            maps_url: null,
          },
        });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "San Francisco" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.restaurants).toHaveLength(2);
    expect(payload.restaurants[0].id).toBe("y1");
    expect(payload.restaurants[1].id).toBe("y2");
    expect(payload.restaurants[0].michelin).toEqual({
      award: null,
      green_star: false,
      matched: false,
    });
    expect(payload.restaurants[0].combined_score).toEqual(expect.any(Number));
    expect(payload.restaurants[1].combined_score).toEqual(expect.any(Number));
    expect(payload.warnings).toEqual([
      { code: "GOOGLE_TIMEOUT", message: "One or more Google enrichment calls timed out." },
      { code: "PARTIAL_ENRICHMENT", message: "Google enrichment is partial; Yelp rows are still shown." },
    ]);
  });

  it("enriches up to top 50 Yelp rows", async () => {
    const yelpRows = Array.from({ length: 60 }, (_, index) => ({
      id: `y${index + 1}`,
      name: `Restaurant ${index + 1}`,
      city: "San Francisco",
      yelp: {
        rating: 4.0,
        review_count: 100 + index,
        price: "$$",
        categories: ["Test"],
        lat: 37.77 + index * 0.0001,
        lng: -122.42,
      },
    }));

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        return Response.json({
          city: "San Francisco",
          restaurants: yelpRows,
        });
      }

      if (url.endsWith("/api/google")) {
        return Response.json({
          ok: true,
          google: {
            rating: 4.5,
            review_count: 999,
            place_id: "place-any",
            maps_url: "https://www.google.com/maps/place/?q=place_id:place-any",
          },
        });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "San Francisco" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.restaurants).toHaveLength(60);

    const googleCallCount = fetchMock.mock.calls.filter(([arg]) =>
      String(arg).endsWith("/api/google"),
    ).length;

    expect(googleCallCount).toBe(50);
  });

  it("limits deployed-mode Google enrichment to 45 rows", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";

    const yelpBusinesses = Array.from({ length: 50 }, (_, index) => ({
      id: `y-${index + 1}`,
      name: `Yelp Restaurant ${index + 1}`,
      rating: 4.0,
      review_count: 10_000 - index,
      price: "$$",
      categories: [{ title: "Test" }],
      coordinates: { latitude: 37.7 + index * 0.001, longitude: -122.4 + index * 0.001 },
      location: {
        address1: `${index + 1} Market St`,
        zip_code: "94103",
        display_address: [`${index + 1} Market St`, "San Francisco, CA 94103"],
      },
    }));

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("api.yelp.com/v3/businesses/search")) {
        return Response.json({ businesses: yelpBusinesses });
      }

      if (url.includes("places.googleapis.com/v1/places:searchText")) {
        return Response.json({ places: [] });
      }

      if (url.includes("maps.googleapis.com/maps/api/place/textsearch/json")) {
        const requestUrl = new URL(url);
        const q = requestUrl.searchParams.get("query") ?? "";
        const name = q.replace(/\s+San Francisco$/, "");
        const slug = encodeURIComponent(name.toLowerCase().replace(/\s+/g, "-"));
        return Response.json({
          status: "OK",
          results: [
            {
              name,
              rating: 4.3,
              user_ratings_total: 500,
              place_id: `google-${slug}`,
              geometry: { location: { lat: 37.7, lng: -122.4 } },
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const request = new Request("https://eat.clairepark.ai/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "San Francisco" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.google_only).toBeUndefined();
    expect(payload.restaurants).toHaveLength(50);

    const googleApiCallCount = fetchMock.mock.calls.filter(([arg]) =>
      String(arg).includes("maps.googleapis.com/maps/api/place/textsearch/json"),
    ).length;
    expect(googleApiCallCount).toBe(45);
  });

  it("keeps Yelp timeout status as 504 on upstream timeout failures", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/yelp")) {
        return new Response(
          JSON.stringify({
            error: { code: "YELP_TIMEOUT", message: "Yelp request timed out." },
          }),
          {
            status: 504,
            headers: { "content-type": "application/json" },
          },
        );
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "San Francisco" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(504);
    expect(payload.error.code).toBe("YELP_TIMEOUT");
  });

  it("preserves hard-fail Yelp response even when prominent prefetch fails", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/yelp")) {
        return new Response(
          JSON.stringify({
            error: { code: "YELP_TIMEOUT", message: "Yelp request timed out." },
          }),
          {
            status: 504,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (url.includes("places.googleapis.com/v1/places:searchText")) {
        return new Response("prominent upstream failure", { status: 500 });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "San Francisco" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();
    const prominentCallCount = fetchMock.mock.calls.filter(([arg]) =>
      String(arg).includes("places.googleapis.com/v1/places:searchText"),
    ).length;

    expect(response.status).toBe(504);
    expect(payload.error.code).toBe("YELP_TIMEOUT");
    expect(payload.warnings).toEqual([]);
    expect(payload.restaurants).toEqual([]);
    expect(prominentCallCount).toBeGreaterThan(0);
  });

  it("keeps Yelp rate-limited status as 429 on upstream rate-limit failures", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/yelp")) {
        return new Response(
          JSON.stringify({
            error: { code: "YELP_RATE_LIMITED", message: "Yelp quota exceeded." },
          }),
          {
            status: 429,
            headers: { "content-type": "application/json" },
          },
        );
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "San Francisco" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(payload.error.code).toBe("YELP_RATE_LIMITED");
  });

  it("propagates GOOGLE_RATE_LIMITED warning from google fallback payload", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        return Response.json({
          city: "San Francisco",
          restaurants: [
            {
              id: "y1",
              name: "Restaurant One",
              city: "San Francisco",
              yelp: {
                rating: 4.5,
                review_count: 200,
                price: "$$",
                categories: ["American"],
                lat: 37.77,
                lng: -122.42,
              },
            },
          ],
        });
      }

      if (url.endsWith("/api/google")) {
        return Response.json({
          ok: false,
          code: "GOOGLE_RATE_LIMITED",
          message: "Google quota exceeded.",
          google: {
            rating: null,
            review_count: null,
            place_id: null,
            maps_url: null,
          },
        });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "San Francisco" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.warnings).toEqual([
      { code: "GOOGLE_RATE_LIMITED", message: "Google rate-limited one or more enrichment calls." },
      { code: "PARTIAL_ENRICHMENT", message: "Google enrichment is partial; Yelp rows are still shown." },
    ]);
  });

  it("falls back to Google-only when Yelp returns a 400 location error", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        return new Response(
          JSON.stringify({
            error: { code: "YELP_UPSTREAM_ERROR", message: "Yelp request failed with status 400." },
          }),
          { status: 502, headers: { "content-type": "application/json" } },
        );
      }

      if (url.includes("maps.googleapis.com")) {
        return Response.json({
          status: "OK",
          results: [
            {
              name: "Seoul BBQ",
              rating: 4.6,
              user_ratings_total: 1200,
              place_id: "seoul-place-1",
              types: ["restaurant", "korean_restaurant"],
              geometry: { location: { lat: 37.5665, lng: 126.978 } },
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "Seoul" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.google_only).toBe(true);
    expect(payload.restaurants).toHaveLength(1);
    expect(payload.restaurants[0].name).toBe("Seoul BBQ");
  });

  it("falls back to Google-only results when Yelp returns zero rows", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        return Response.json({
          city: "Seoul",
          restaurants: [],
        });
      }

      if (url.includes("maps.googleapis.com")) {
        return Response.json({
          status: "OK",
          results: [
            {
              name: "Seoul BBQ",
              rating: 4.6,
              user_ratings_total: 1200,
              place_id: "seoul-place-1",
              types: ["restaurant", "food", "korean_restaurant"],
              geometry: { location: { lat: 37.5665, lng: 126.978 } },
            },
            {
              name: "Kimchi House",
              rating: 4.3,
              user_ratings_total: 800,
              place_id: "seoul-place-2",
              types: ["restaurant", "establishment"],
              geometry: { location: { lat: 37.567, lng: 126.979 } },
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "Seoul" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.google_only).toBe(true);
    expect(payload.restaurants).toHaveLength(2);
    expect(payload.restaurants[0].name).toBe("Seoul BBQ");
    expect(payload.restaurants[0].google.rating).toBe(4.6);
    expect(payload.restaurants[0].google.place_id).toBe("seoul-place-1");
    expect(payload.restaurants[0].yelp.rating).toBe(0);
    expect(payload.restaurants[0].yelp.review_count).toBe(0);
    expect(payload.restaurants[0].id).toMatch(/^google-fallback-/);
    expect(payload.restaurants[0].combined_score).toEqual(expect.any(Number));
    expect(payload.restaurants[0].yelp.categories).toEqual(["Korean Restaurant"]);
  });

  it("uses Places API (New) pagination for Google-only fallback and caps to 50 rows", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";

    const makePlaces = (start: number, count: number) =>
      Array.from({ length: count }, (_, i) => {
        const n = start + i;
        return {
          id: `place-${n}`,
          displayName: { text: `Prominent Restaurant ${n}` },
          userRating: 4.1,
          userRatingCount: 1000 + n,
          location: { latitude: 37.7 + n * 0.0001, longitude: -122.4 },
          formattedAddress: `${n} Test St, San Francisco, CA`,
          types: ["restaurant", "food"],
        };
      });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        return Response.json({ city: "Seoul", restaurants: [] });
      }

      if (url.includes("places.googleapis.com/v1/places:searchText")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { pageToken?: string };
        if (!body.pageToken) {
          return Response.json({ places: makePlaces(1, 20), nextPageToken: "token-1" });
        }
        if (body.pageToken === "token-1") {
          return Response.json({ places: makePlaces(21, 20), nextPageToken: "token-2" });
        }
        if (body.pageToken === "token-2") {
          return Response.json({ places: makePlaces(41, 20) });
        }
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "Seoul" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.google_only).toBe(true);
    expect(payload.restaurants).toHaveLength(50);
    expect(payload.warnings).toEqual([]);
    expect(payload.restaurants[0].name).toBe("Prominent Restaurant 1");
    expect(payload.restaurants[49].name).toBe("Prominent Restaurant 50");
    expect(payload.restaurants[0].id).toMatch(/^google-fallback-/);
  });

  it("retries once when prominent page token is not yet valid", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";

    let tokenAttemptCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        return Response.json({ city: "Seoul", restaurants: [] });
      }

      if (url.includes("places.googleapis.com/v1/places:searchText")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { pageToken?: string };
        if (!body.pageToken) {
          return Response.json({
            places: [
              {
                id: "place-1",
                displayName: { text: "Prominent Restaurant 1" },
                userRating: 4.5,
                userRatingCount: 1000,
                location: { latitude: 37.7, longitude: -122.4 },
                formattedAddress: "1 Test St, Seoul",
                types: ["restaurant"],
              },
            ],
            nextPageToken: "token-1",
          });
        }
        if (body.pageToken === "token-1") {
          tokenAttemptCount += 1;
          if (tokenAttemptCount === 1) {
            return new Response(
              JSON.stringify({ error: { status: "INVALID_ARGUMENT", message: "page token not ready" } }),
              { status: 400, headers: { "content-type": "application/json" } },
            );
          }
          return Response.json({
            places: [
              {
                id: "place-2",
                displayName: { text: "Prominent Restaurant 2" },
                userRating: 4.4,
                userRatingCount: 800,
                location: { latitude: 37.701, longitude: -122.401 },
                formattedAddress: "2 Test St, Seoul",
                types: ["restaurant"],
              },
            ],
          });
        }
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "Seoul" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.google_only).toBe(true);
    expect(payload.restaurants).toHaveLength(2);
    expect(payload.warnings).toEqual([]);
    expect(tokenAttemptCount).toBe(2);
  });

  it("tops up prominent fallback rows with legacy fallback results when prominent is partial", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";

    const prominentPlaces = Array.from({ length: 30 }, (_, i) => ({
      id: `prominent-${i + 1}`,
      displayName: { text: `Prominent ${i + 1}` },
      userRating: 4.3,
      userRatingCount: 1000 + i,
      location: { latitude: 37.7 + i * 0.0001, longitude: -122.4 },
      formattedAddress: `${i + 1} Prominent St`,
      types: ["restaurant"],
    }));

    const legacyResults = Array.from({ length: 50 }, (_, i) => ({
      name: `Legacy ${i + 1}`,
      rating: 4.0,
      user_ratings_total: 500 + i,
      place_id: `legacy-${i + 1}`,
      types: ["restaurant"],
      geometry: { location: { lat: 37.8 + i * 0.0001, lng: -122.5 } },
    }));

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/yelp")) {
        return Response.json({ city: "Seoul", restaurants: [] });
      }
      if (url.includes("places.googleapis.com/v1/places:searchText")) {
        return Response.json({ places: prominentPlaces });
      }
      if (url.includes("maps.googleapis.com")) {
        return Response.json({ status: "OK", results: legacyResults });
      }
      throw new Error(`Unexpected fetch target: ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "Seoul" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.google_only).toBe(true);
    expect(payload.restaurants).toHaveLength(50);
    expect(payload.warnings).toEqual([]);
    expect(payload.restaurants[0].name).toBe("Prominent 1");
  });

  it("surfaces GOOGLE_TIMEOUT when prominent pagination exceeds total budget", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";

    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/yelp")) {
        return Response.json({ city: "Seoul", restaurants: [] });
      }
      if (url.includes("places.googleapis.com/v1/places:searchText")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { pageToken?: string };
        if (!body.pageToken) {
          now = 13_000; // Force next loop iteration to exceed GOOGLE_PROMINENT_TOTAL_BUDGET_MS.
          return Response.json({
            places: [
              {
                id: "prominent-timeout-1",
                displayName: { text: "Prominent Timeout 1" },
                userRating: 4.2,
                userRatingCount: 420,
                location: { latitude: 37.7, longitude: -122.4 },
                formattedAddress: "1 Timeout St, Seoul",
                types: ["restaurant"],
              },
            ],
            nextPageToken: "token-timeout-1",
          });
        }
      }
      if (url.includes("maps.googleapis.com")) {
        return Response.json({ status: "ZERO_RESULTS", results: [] });
      }
      throw new Error(`Unexpected fetch target: ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "Seoul" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.google_only).toBe(true);
    expect(payload.restaurants).toHaveLength(1);
    expect(payload.warnings).toEqual([
      { code: "GOOGLE_TIMEOUT", message: "Google prominent fallback search timed out." },
    ]);
  });

  it("returns empty without error when Yelp returns zero and Google returns ZERO_RESULTS", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        return Response.json({ city: "Middle of Nowhere", restaurants: [] });
      }

      if (url.includes("maps.googleapis.com")) {
        return Response.json({ status: "ZERO_RESULTS", results: [] });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "Middle of Nowhere" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.google_only).toBe(true);
    expect(payload.restaurants).toHaveLength(0);
    expect(payload.warnings).toEqual([]);
  });

  it("falls back to Google-only when Yelp fetch throws a network error", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        throw new TypeError("fetch failed");
      }

      if (url.includes("maps.googleapis.com")) {
        return Response.json({
          status: "OK",
          results: [
            {
              name: "Network Fallback Place",
              rating: 4.1,
              user_ratings_total: 300,
              place_id: "net-place-1",
              types: ["restaurant"],
              geometry: { location: { lat: 40.7, lng: -74.0 } },
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "Atlantis" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.google_only).toBe(true);
    expect(payload.restaurants).toHaveLength(1);
    expect(payload.restaurants[0].name).toBe("Network Fallback Place");
  });

  it("recovers from internal Yelp self-fetch failure by invoking Yelp route handler directly", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        throw new TypeError("self fetch failed");
      }

      if (url.includes("api.yelp.com/v3/businesses/search")) {
        return Response.json({
          businesses: [
            {
              id: "y1",
              name: "Recovered Yelp Row",
              rating: 4.4,
              review_count: 3200,
              price: "$$",
              categories: [{ title: "American" }],
              coordinates: { latitude: 37.77, longitude: -122.42 },
              location: {
                address1: "123 Recovery St",
                zip_code: "94103",
                display_address: ["123 Recovery St", "San Francisco, CA 94103"],
              },
            },
          ],
        });
      }

      if (url.endsWith("/api/google")) {
        return Response.json({
          ok: true,
          google: {
            rating: 4.6,
            review_count: 1800,
            place_id: "recovered-google",
            maps_url: "https://www.google.com/maps/place/?q=place_id:recovered-google",
          },
        });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "San Francisco" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.google_only).not.toBe(true);
    expect(payload.restaurants).toHaveLength(1);
    expect(payload.restaurants[0].id).toBe("y1");
    expect(payload.restaurants[0].yelp.review_count).toBe(3200);
    expect(payload.restaurants[0].google.place_id).toBe("recovered-google");
  });

  it("recovers when internal Yelp self-fetch returns non-OK", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        return new Response(
          JSON.stringify({
            error: { code: "YELP_UPSTREAM_ERROR", message: "Self-fetch internal proxy failed." },
          }),
          {
            status: 502,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (url.includes("api.yelp.com/v3/businesses/search")) {
        return Response.json({
          businesses: [
            {
              id: "y2",
              name: "Recovered Non-OK Yelp Row",
              rating: 4.2,
              review_count: 2100,
              price: "$$",
              categories: [{ title: "Seafood" }],
              coordinates: { latitude: 37.79, longitude: -122.39 },
              location: {
                address1: "456 Recovery Ave",
                zip_code: "94105",
                display_address: ["456 Recovery Ave", "San Francisco, CA 94105"],
              },
            },
          ],
        });
      }

      if (url.endsWith("/api/google")) {
        return Response.json({
          ok: true,
          google: {
            rating: 4.4,
            review_count: 1700,
            place_id: "recovered-non-ok-google",
            maps_url: "https://www.google.com/maps/place/?q=place_id:recovered-non-ok-google",
          },
        });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "San Francisco" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.google_only).not.toBe(true);
    expect(payload.restaurants).toHaveLength(1);
    expect(payload.restaurants[0].id).toBe("y2");
    expect(payload.restaurants[0].yelp.review_count).toBe(2100);
    expect(payload.restaurants[0].google.place_id).toBe("recovered-non-ok-google");
  });

  it("returns empty with warning when Yelp returns zero and Google also fails", async () => {
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        return Response.json({
          city: "Nowhere",
          restaurants: [],
        });
      }

      if (url.includes("maps.googleapis.com")) {
        return new Response("error", { status: 500 });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "Nowhere" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.google_only).toBe(true);
    expect(payload.restaurants).toHaveLength(0);
    expect(payload.warnings).toEqual([
      { code: "GOOGLE_UPSTREAM_ERROR", message: "Google fallback search failed." },
    ]);
  });

  it("emits fallback diagnostics with failure counts in development mode", async () => {
    process.env.NODE_ENV = "development";
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    const diagnosticsSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        return Response.json({
          city: "Nowhere",
          restaurants: [],
        });
      }

      if (url.includes("maps.googleapis.com")) {
        return new Response("error", { status: 500 });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "Nowhere" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    expect(response.status).toBe(200);

    expect(diagnosticsSpy).toHaveBeenCalledWith(
      "[search-diagnostics]",
      expect.objectContaining({
        mode: "google_fallback",
        city: "Nowhere",
        google_rows_attempted: 0,
        google_rows_response_ok: 0,
        google_rows_accepted: 0,
        google_prominent_fetched: 0,
        google_prominent_added: 0,
        google_prominent_deduped: 0,
        google_prominent_ms: expect.any(Number),
        google_enrichment_failures: {
          GOOGLE_UPSTREAM_ERROR: 1,
        },
      }),
    );
  });

  it("emits diagnostics logs in development with match rates and latencies", async () => {
    process.env.NODE_ENV = "development";
    const diagnosticsSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        return Response.json({
          city: "San Francisco",
          restaurants: [
            {
              id: "y1",
              name: "Restaurant One",
              city: "San Francisco",
              yelp: {
                rating: 4.5,
                review_count: 200,
                price: "$$",
                categories: ["American"],
                lat: 37.77,
                lng: -122.42,
              },
            },
          ],
        });
      }

      if (url.endsWith("/api/google")) {
        return Response.json({
          ok: true,
          google: {
            rating: 4.7,
            review_count: 600,
            place_id: "google-1",
            maps_url: "https://www.google.com/maps/place/?q=place_id:google-1",
          },
        });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "San Francisco" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    expect(response.status).toBe(200);

    expect(diagnosticsSpy).toHaveBeenCalledWith(
      "[search-diagnostics]",
      expect.objectContaining({
        mode: "yelp_primary",
        city: "San Francisco",
        yelp_status: "ok",
        google_rows_attempted: 1,
        google_rows_response_ok: 1,
        google_rows_accepted: 1,
        google_prominent_fetched: 0,
        google_prominent_added: 0,
        google_prominent_deduped: 0,
        google_prominent_ms: expect.any(Number),
      }),
    );

    const diagnosticsPayload = diagnosticsSpy.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(typeof diagnosticsPayload.total_ms).toBe("number");
    expect(typeof diagnosticsPayload.google_ms).toBe("number");
    expect(diagnosticsPayload.google_match_rate).toBe(1);
  });

  it("treats malformed google payloads as upstream warning while keeping rows", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        return Response.json({
          city: "San Francisco",
          restaurants: [
            {
              id: "y1",
              name: "Restaurant One",
              city: "San Francisco",
              yelp: {
                rating: 4.5,
                review_count: 200,
                price: "$$",
                categories: ["American"],
                lat: 37.77,
                lng: -122.42,
              },
            },
          ],
        });
      }

      if (url.endsWith("/api/google")) {
        return Response.json({ unexpected: true });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "San Francisco" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.restaurants).toHaveLength(1);
    expect(payload.warnings).toEqual([
      { code: "GOOGLE_UPSTREAM_ERROR", message: "Google enrichment failed for one or more rows." },
      { code: "PARTIAL_ENRICHMENT", message: "Google enrichment is partial; Yelp rows are still shown." },
    ]);
  });

  it("redacts combined_score in public profile for normal yelp-primary responses", async () => {
    process.env.APP_PROFILE = "public";
    process.env.NEXT_PUBLIC_APP_PROFILE = "public";
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        return Response.json({
          city: "San Francisco",
          restaurants: [
            {
              id: "y1",
              name: "Restaurant One",
              city: "San Francisco",
              yelp: {
                rating: 4.4,
                review_count: 200,
                price: "$$",
                categories: ["American"],
                lat: 37.77,
                lng: -122.42,
              },
            },
          ],
        });
      }

      if (url.endsWith("/api/google")) {
        return Response.json({
          ok: true,
          google: {
            rating: 4.7,
            review_count: 600,
            place_id: "google-1",
            maps_url: "https://www.google.com/maps/place/?q=place_id:google-1",
          },
        });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "San Francisco" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.google_only).not.toBe(true);
    expect(payload.restaurants).toHaveLength(1);
    expect(payload.restaurants[0].combined_score).toBeNull();
  });

  it("redacts combined_score in public profile for google-only fallback responses", async () => {
    process.env.APP_PROFILE = "public";
    process.env.NEXT_PUBLIC_APP_PROFILE = "public";
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/yelp")) {
        return Response.json({
          city: "Seoul",
          restaurants: [],
        });
      }

      if (url.includes("places.googleapis.com")) {
        return Response.json({
          places: [
            {
              id: "place-seoul-1",
              displayName: { text: "Seoul Spot" },
              rating: 4.5,
              userRatingCount: 1234,
              location: { latitude: 37.5665, longitude: 126.978 },
              formattedAddress: "Seoul",
              types: ["restaurant"],
            },
          ],
        });
      }

      if (url.includes("maps.googleapis.com")) {
        return Response.json({
          status: "ZERO_RESULTS",
          results: [],
        });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "Seoul" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.google_only).toBe(true);
    expect(payload.restaurants.length).toBeGreaterThan(0);
    expect(payload.restaurants[0].combined_score).toBeNull();
  });

  it("serves snapshot payload with google_only=true when snapshot marks Google Only", async () => {
    process.env.APP_PROFILE = "public";
    process.env.NEXT_PUBLIC_APP_PROFILE = "public";
    process.env.SEARCH_SNAPSHOT_PUBLIC_ENABLED = "1";
    process.env.SEARCH_SNAPSHOT_VERSION = "test-google-only";

    const path = await import("node:path");
    const fs = await import("node:fs/promises");
    const versionDir = path.join(process.cwd(), "data", "precompute", "test-google-only");
    await fs.mkdir(versionDir, { recursive: true });

    const nowIso = new Date().toISOString();
    const summary = {
      version: "test-google-only",
      finished_at_utc: nowIso,
      results: [{ city: "Seoul, South Korea", slug: "seoul-south-korea", success: true }],
    };
    await fs.writeFile(path.join(versionDir, "_run-summary.json"), JSON.stringify(summary), "utf8");
    await fs.writeFile(
      path.join(versionDir, "seoul-south-korea.csv"),
      [
        "Rank,Restaurant,Score,Total Reviews,Yelp Rating,Yelp Reviews,Google Rating,Google Reviews,Price,Cuisine,City,Google Maps URL,Snapshot UTC,Google Only",
        `1,Seoul Snapshot Place,8.4,1200,,,4.6,1200,,Korean,"Seoul, South Korea",https://www.google.com/maps/place/?q=place_id:seoul-place,${nowIso},true`,
      ].join("\n"),
      "utf8",
    );

    global.fetch = vi.fn(async () => {
      throw new Error("Snapshot path should not call upstream fetch.");
    }) as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "Seoul, South Korea" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.google_only).toBe(true);
    expect(payload.restaurants).toHaveLength(1);
    expect(payload.restaurants[0].combined_score).toBeNull();

    await fs.rm(versionDir, { recursive: true, force: true });
  });

  it("serves snapshot from configured HTTP base when local files are unavailable", async () => {
    process.env.APP_PROFILE = "public";
    process.env.NEXT_PUBLIC_APP_PROFILE = "public";
    process.env.SEARCH_SNAPSHOT_PUBLIC_ENABLED = "1";
    process.env.SEARCH_SNAPSHOT_VERSION = "test-http-fallback";
    process.env.SEARCH_SNAPSHOT_HTTP_BASE_URL = "https://snapshots.example.com/precompute";

    const nowIso = new Date().toISOString();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://snapshots.example.com/precompute/test-http-fallback/_run-summary.json") {
        return Response.json({
          version: "test-http-fallback",
          finished_at_utc: nowIso,
          results: [{ city: "San Francisco, CA", slug: "san-francisco-ca", success: true }],
        });
      }
      if (url === "https://snapshots.example.com/precompute/test-http-fallback/san-francisco-ca.csv") {
        return new Response(
          [
            "Rank,Restaurant,Score,Total Reviews,Yelp Rating,Yelp Reviews,Google Rating,Google Reviews,Price,Cuisine,City,Google Maps URL,Snapshot UTC,Google Only",
            `1,HTTP Snapshot Place,8.8,1500,4.6,500,4.7,1000,$$,American,\"San Francisco, CA\",https://www.google.com/maps/place/?q=place_id:http-snapshot-1,${nowIso},false`,
          ].join("\n"),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch target: ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "San Francisco, CA" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.restaurants).toHaveLength(1);
    expect(payload.restaurants[0].name).toBe("HTTP Snapshot Place");
    expect(payload.google_only).not.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://snapshots.example.com/precompute/test-http-fallback/_run-summary.json",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://snapshots.example.com/precompute/test-http-fallback/san-francisco-ca.csv",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("ignores malformed snapshot timestamp and falls back to live path", async () => {
    process.env.APP_PROFILE = "public";
    process.env.NEXT_PUBLIC_APP_PROFILE = "public";
    process.env.SEARCH_SNAPSHOT_PUBLIC_ENABLED = "1";
    process.env.SEARCH_SNAPSHOT_VERSION = "test-bad-snapshot-ts";
    process.env.YELP_API_KEY = "test-key";
    process.env.GOOGLE_MAPS_API_KEY = "test-key";

    const path = await import("node:path");
    const fs = await import("node:fs/promises");
    const versionDir = path.join(process.cwd(), "data", "precompute", "test-bad-snapshot-ts");
    await fs.mkdir(versionDir, { recursive: true });

    const summary = {
      version: "test-bad-snapshot-ts",
      finished_at_utc: "not-a-date",
      results: [{ city: "San Francisco, CA", slug: "san-francisco-ca", success: true }],
    };
    await fs.writeFile(path.join(versionDir, "_run-summary.json"), JSON.stringify(summary), "utf8");
    await fs.writeFile(
      path.join(versionDir, "san-francisco-ca.csv"),
      [
        "Rank,Restaurant,Score,Total Reviews,Yelp Rating,Yelp Reviews,Google Rating,Google Reviews,Price,Cuisine,City,Google Maps URL,Snapshot UTC,Google Only",
        "1,Bad Timestamp Snapshot,8.9,1000,4.5,100,4.7,900,$$,American,\"San Francisco, CA\",https://www.google.com/maps/place/?q=place_id:bad-ts,not-a-date,false",
      ].join("\n"),
      "utf8",
    );

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/yelp")) {
        return Response.json({
          city: "San Francisco, CA",
          restaurants: [
            {
              id: "y-live-1",
              name: "Live Fallback Row",
              city: "San Francisco, CA",
              yelp: {
                rating: 4.2,
                review_count: 150,
                price: "$$",
                categories: ["American"],
                lat: 37.77,
                lng: -122.42,
              },
            },
          ],
        });
      }
      if (url.endsWith("/api/google")) {
        return Response.json({
          ok: true,
          google: {
            rating: 4.5,
            review_count: 700,
            place_id: "live-google-1",
            maps_url: "https://www.google.com/maps/place/?q=place_id:live-google-1",
          },
        });
      }
      throw new Error(`Unexpected fetch target: ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "San Francisco, CA" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.restaurants).toHaveLength(1);
    expect(payload.restaurants[0].name).toBe("Live Fallback Row");
    expect(payload.google_only).not.toBe(true);
    expect(fetchMock).toHaveBeenCalled();

    await fs.rm(versionDir, { recursive: true, force: true });
  });

  it("serves stale snapshot in public mode by default instead of falling back to live path", async () => {
    process.env.APP_PROFILE = "public";
    process.env.NEXT_PUBLIC_APP_PROFILE = "public";
    process.env.SEARCH_SNAPSHOT_PUBLIC_ENABLED = "1";
    process.env.SEARCH_SNAPSHOT_VERSION = "test-stale-snapshot-default";
    process.env.SEARCH_SNAPSHOT_MAX_AGE_MINUTES = "0";

    const path = await import("node:path");
    const fs = await import("node:fs/promises");
    const versionDir = path.join(process.cwd(), "data", "precompute", "test-stale-snapshot-default");
    await fs.mkdir(versionDir, { recursive: true });

    const oldIso = "2024-01-01T00:00:00.000Z";
    const summary = {
      version: "test-stale-snapshot-default",
      finished_at_utc: oldIso,
      results: [{ city: "San Francisco, CA", slug: "san-francisco-ca", success: true }],
    };
    await fs.writeFile(path.join(versionDir, "_run-summary.json"), JSON.stringify(summary), "utf8");
    await fs.writeFile(
      path.join(versionDir, "san-francisco-ca.csv"),
      [
        "Rank,Restaurant,Score,Total Reviews,Yelp Rating,Yelp Reviews,Google Rating,Google Reviews,Price,Cuisine,City,Google Maps URL,Snapshot UTC,Google Only",
        `1,Old Snapshot Place,8.9,1000,4.6,500,4.7,500,$$,American,\"San Francisco, CA\",https://www.google.com/maps/place/?q=place_id:old-snapshot,${oldIso},false`,
      ].join("\n"),
      "utf8",
    );

    global.fetch = vi.fn(async () => {
      throw new Error("Expected stale snapshot to be served without live fetch.");
    }) as typeof fetch;

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      body: JSON.stringify({ city: "San Francisco, CA" }),
      headers: { "content-type": "application/json" },
    });

    const response = await searchPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.restaurants).toHaveLength(1);
    expect(payload.restaurants[0].name).toBe("Old Snapshot Place");

    await fs.rm(versionDir, { recursive: true, force: true });
  });
});
