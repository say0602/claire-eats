import { NextResponse } from "next/server";
import type { Restaurant, SearchResponseFailure, SearchResponseSuccess, SearchWarning, WarningCode } from "@/lib/types";
import { getServerEnv } from "@/lib/env";
import { buildMapsUrl, rejectGoogleEnrichment } from "@/lib/matching";
import { matchMichelinForRestaurant } from "@/lib/michelin";
import { computeCombinedScores } from "@/lib/scoring";

const MAX_GOOGLE_ENRICHMENTS = 50;
const GOOGLE_CONCURRENCY = 5;
const GOOGLE_REQUEST_TIMEOUT_MS = 3000;
const ENRICHMENT_BUDGET_MS =
  Math.ceil((MAX_GOOGLE_ENRICHMENTS / GOOGLE_CONCURRENCY) * GOOGLE_REQUEST_TIMEOUT_MS) + 1000;
const GOOGLE_FALLBACK_LIMIT = 20;
const GOOGLE_FALLBACK_TIMEOUT_MS = 5000;
const GOOGLE_TEXT_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json";
const YELP_HARD_FAIL_CODES = new Set(["CONFIG_ERROR", "YELP_RATE_LIMITED", "YELP_TIMEOUT"]);
const GOOGLE_TYPE_SKIP = new Set(["point_of_interest", "establishment", "food", "restaurant"]);

type YelpSeed = {
  id: string;
  name: string;
  city: string;
  yelp: {
    rating: number;
    review_count: number;
    price: Restaurant["yelp"]["price"];
    categories: string[];
    lat: number;
    lng: number;
    address?: string | null;
    postal_code?: string | null;
  };
};

type GoogleRouteSuccess = {
  ok: true;
  google: Restaurant["google"];
};

type GoogleRouteFallback = {
  ok: false;
  code: WarningCode;
  message: string;
  google: Restaurant["google"];
};

function isGoogleRecord(value: unknown): value is Restaurant["google"] {
  if (!value || typeof value !== "object") return false;
  const google = value as Record<string, unknown>;
  const isNullableNumber = (v: unknown) => v === null || typeof v === "number";
  const isNullableString = (v: unknown) => v === null || typeof v === "string";

  return (
    isNullableNumber(google.rating) &&
    isNullableNumber(google.review_count) &&
    isNullableString(google.place_id) &&
    isNullableString(google.maps_url)
  );
}

function isGoogleRoutePayload(value: unknown): value is GoogleRouteSuccess | GoogleRouteFallback {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  if (typeof payload.ok !== "boolean") return false;
  if (!isGoogleRecord(payload.google)) return false;

  if (payload.ok) return true;
  return (
    payload.code === "GOOGLE_TIMEOUT" ||
    payload.code === "GOOGLE_RATE_LIMITED" ||
    payload.code === "GOOGLE_UPSTREAM_ERROR" ||
    payload.code === "PARTIAL_ENRICHMENT"
  );
}

function failureEnvelope(
  city: string,
  code: string,
  message: string,
  warnings: SearchWarning[] = [],
): SearchResponseFailure {
  return {
    city,
    restaurants: [],
    warnings,
    error: { code, message },
  };
}

function withTimeout(ms: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId),
  };
}

function warningMessage(code: WarningCode) {
  switch (code) {
    case "GOOGLE_TIMEOUT":
      return "One or more Google enrichment calls timed out.";
    case "GOOGLE_RATE_LIMITED":
      return "Google rate-limited one or more enrichment calls.";
    case "GOOGLE_UPSTREAM_ERROR":
      return "Google enrichment failed for one or more rows.";
    case "PARTIAL_ENRICHMENT":
      return "Google enrichment is partial; Yelp rows are still shown.";
    default:
      return "Enrichment warning.";
  }
}

function buildRestaurantFromSeed(seed: YelpSeed): Restaurant {
  return {
    id: seed.id,
    name: seed.name,
    city: seed.city,
    yelp: seed.yelp,
    google: rejectGoogleEnrichment(),
    michelin: {
      award: null,
      green_star: false,
      matched: false,
    },
    combined_score: null,
  };
}

type GoogleTextSearchResult = {
  name?: string;
  rating?: number;
  user_ratings_total?: number;
  place_id?: string;
  types?: string[];
  geometry?: { location?: { lat?: number; lng?: number } };
};

type GoogleTextSearchResponse = {
  status?: string;
  results?: GoogleTextSearchResult[];
};

function categoriesFromTypes(types: string[] | undefined): string[] {
  if (!types) return [];
  return types
    .filter((t) => !GOOGLE_TYPE_SKIP.has(t))
    .slice(0, 3)
    .map((t) => t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
}

function buildRestaurantFromGoogleResult(result: GoogleTextSearchResult, city: string, index: number): Restaurant {
  const placeId = result.place_id ?? null;
  const lat = result.geometry?.location?.lat ?? 0;
  const lng = result.geometry?.location?.lng ?? 0;

  return {
    id: `google-fallback-${index}`,
    name: result.name ?? "Unknown",
    city,
    yelp: {
      rating: 0,
      review_count: 0,
      price: null,
      categories: categoriesFromTypes(result.types),
      lat,
      lng,
    },
    google: {
      rating: result.rating ?? null,
      review_count: result.user_ratings_total ?? null,
      place_id: placeId,
      maps_url: buildMapsUrl(placeId),
    },
    michelin: { award: null, green_star: false, matched: false },
    combined_score: null,
  };
}

async function fetchGoogleFallbackRows(city: string): Promise<{ restaurants: Restaurant[]; warnings: SearchWarning[] }> {
  let apiKey: string;
  try {
    apiKey = getServerEnv().GOOGLE_MAPS_API_KEY;
  } catch {
    return { restaurants: [], warnings: [{ code: "GOOGLE_UPSTREAM_ERROR", message: "Google API key is not configured." }] };
  }

  const url = new URL(GOOGLE_TEXT_SEARCH_URL);
  url.searchParams.set("query", `restaurants in ${city}`);
  url.searchParams.set("type", "restaurant");
  url.searchParams.set("key", apiKey);

  const timeout = withTimeout(GOOGLE_FALLBACK_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: "GET", signal: timeout.signal, cache: "no-store" });
    if (!response.ok) {
      return { restaurants: [], warnings: [{ code: "GOOGLE_UPSTREAM_ERROR", message: "Google fallback search failed." }] };
    }

    const payload = (await response.json()) as GoogleTextSearchResponse;

    if (payload.status === "ZERO_RESULTS" || (payload.status === "OK" && (!payload.results || payload.results.length === 0))) {
      return { restaurants: [], warnings: [] };
    }

    if (payload.status !== "OK" || !payload.results) {
      return { restaurants: [], warnings: [{ code: "GOOGLE_UPSTREAM_ERROR", message: "Google fallback search failed." }] };
    }

    const restaurants = payload.results
      .slice(0, GOOGLE_FALLBACK_LIMIT)
      .map((result, i) => buildRestaurantFromGoogleResult(result, city, i));

    return { restaurants, warnings: [] };
  } catch (error) {
    const code: WarningCode = error instanceof Error && error.name === "AbortError" ? "GOOGLE_TIMEOUT" : "GOOGLE_UPSTREAM_ERROR";
    return { restaurants: [], warnings: [{ code, message: "Google fallback search failed." }] };
  } finally {
    timeout.clear();
  }
}

async function googleOnlyFallback(city: string) {
  const fallback = await fetchGoogleFallbackRows(city);
  const scored = computeCombinedScores(fallback.restaurants);
  const response: SearchResponseSuccess = {
    city,
    restaurants: scored,
    warnings: fallback.warnings,
    google_only: true,
  };
  return NextResponse.json(response);
}

export async function POST(request: Request) {
  let city = "";
  try {
    const body = await request.json();
    city = typeof body?.city === "string" ? body.city.trim() : "";
  } catch {
    return NextResponse.json(
      failureEnvelope("", "INVALID_INPUT", "Request body must be valid JSON."),
      { status: 400 },
    );
  }

  if (!city) {
    return NextResponse.json(failureEnvelope("", "INVALID_INPUT", "Field `city` is required."), {
      status: 400,
    });
  }

  const origin = new URL(request.url).origin;
  let yelpResponse: Response;
  try {
    yelpResponse = await fetch(`${origin}/api/yelp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ city }),
      cache: "no-store",
    });
  } catch {
    return googleOnlyFallback(city);
  }

  if (!yelpResponse.ok) {
    const yelpPayload = (await yelpResponse.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    const code = yelpPayload?.error?.code ?? "YELP_UPSTREAM_ERROR";
    const message = yelpPayload?.error?.message ?? "Failed to fetch Yelp restaurants.";

    if (YELP_HARD_FAIL_CODES.has(code)) {
      const status =
        code === "CONFIG_ERROR"
          ? 500
          : code === "YELP_RATE_LIMITED"
            ? 429
            : 504;
      return NextResponse.json(failureEnvelope(city, code, message), { status });
    }

    return googleOnlyFallback(city);
  }

  const yelpPayload = (await yelpResponse.json()) as { city: string; restaurants: YelpSeed[] };
  const restaurants = yelpPayload.restaurants.map((seed) => buildRestaurantFromSeed(seed));

  if (restaurants.length === 0) {
    return googleOnlyFallback(city);
  }

  const targetCount = Math.min(restaurants.length, MAX_GOOGLE_ENRICHMENTS);

  const warningCodes = new Set<WarningCode>();
  const enrichmentDeadlineMs = Date.now() + ENRICHMENT_BUDGET_MS;

  let cursor = 0;
  const workers = Array.from({ length: GOOGLE_CONCURRENCY }).map(async () => {
    while (cursor < targetCount) {
      if (Date.now() > enrichmentDeadlineMs) {
        warningCodes.add("GOOGLE_TIMEOUT");
        break;
      }

      const index = cursor;
      cursor += 1;

      const restaurant = restaurants[index];
      const timeout = withTimeout(GOOGLE_REQUEST_TIMEOUT_MS);

      try {
        const googleResponse = await fetch(`${origin}/api/google`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: restaurant.name,
            city,
            lat: restaurant.yelp.lat,
            lng: restaurant.yelp.lng,
            address: restaurant.yelp.address ?? null,
            postal_code: restaurant.yelp.postal_code ?? null,
          }),
          signal: timeout.signal,
          cache: "no-store",
        });

        if (!googleResponse.ok) {
          warningCodes.add("GOOGLE_UPSTREAM_ERROR");
          continue;
        }

        const googlePayload = await googleResponse.json();
        if (!isGoogleRoutePayload(googlePayload)) {
          warningCodes.add("GOOGLE_UPSTREAM_ERROR");
          continue;
        }

        if (googlePayload.ok) {
          restaurant.google = googlePayload.google;
        } else {
          restaurant.google = googlePayload.google;
          warningCodes.add(googlePayload.code);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          warningCodes.add("GOOGLE_TIMEOUT");
        } else {
          warningCodes.add("GOOGLE_UPSTREAM_ERROR");
        }
      } finally {
        timeout.clear();
      }
    }
  });

  await Promise.all(workers);

  const restaurantsWithMichelin = restaurants.map((restaurant) => ({
    ...restaurant,
    michelin: matchMichelinForRestaurant({
      city: restaurant.city,
      lat: restaurant.yelp.lat,
      lng: restaurant.yelp.lng,
    }),
  }));

  const scoredRestaurants = computeCombinedScores(restaurantsWithMichelin);

  if (warningCodes.size > 0) {
    warningCodes.add("PARTIAL_ENRICHMENT");
  }

  const warningOrder: WarningCode[] = [
    "GOOGLE_TIMEOUT",
    "GOOGLE_RATE_LIMITED",
    "GOOGLE_UPSTREAM_ERROR",
    "PARTIAL_ENRICHMENT",
  ];

  const warnings: SearchWarning[] = warningOrder
    .filter((code) => warningCodes.has(code))
    .map((code) => ({
      code,
      message: warningMessage(code),
    }));

  const response: SearchResponseSuccess = {
    city,
    restaurants: scoredRestaurants,
    warnings,
  };

  return NextResponse.json(response);
}
