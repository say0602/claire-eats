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
      },
    });
  });
});

describe("search orchestrator", () => {
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

  it("enriches only top 20 Yelp rows", async () => {
    const yelpRows = Array.from({ length: 25 }, (_, index) => ({
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
    expect(payload.restaurants).toHaveLength(25);

    const googleCallCount = fetchMock.mock.calls.filter(([arg]) =>
      String(arg).endsWith("/api/google"),
    ).length;

    expect(googleCallCount).toBe(20);
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
});
