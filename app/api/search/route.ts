import { NextResponse } from "next/server";
import type { Restaurant, SearchResponseFailure, SearchResponseSuccess, SearchWarning, WarningCode } from "@/lib/types";
import { getServerEnv } from "@/lib/env";
import { buildMapsUrl, rejectGoogleEnrichment } from "@/lib/matching";
import { matchMichelinForRestaurant } from "@/lib/michelin";
import { computeCombinedScores } from "@/lib/scoring";
import { POST as yelpPost } from "@/app/api/yelp/route";
import { POST as googlePost } from "@/app/api/google/route";

const MAX_GOOGLE_ENRICHMENTS = 50;
const GOOGLE_CONCURRENCY = 5;
const GOOGLE_REQUEST_TIMEOUT_MS = 3000;
const ENRICHMENT_BUDGET_MS =
  Math.ceil((MAX_GOOGLE_ENRICHMENTS / GOOGLE_CONCURRENCY) * GOOGLE_REQUEST_TIMEOUT_MS) + 1000;
const DEPLOYED_MAX_GOOGLE_ENRICHMENTS = 48;
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

type SearchDiagnostics = {
  mode: "yelp_primary" | "google_fallback" | "yelp_error";
  city: string;
  total_ms: number;
  yelp_status: string;
  yelp_ms: number | null;
  google_ms: number | null;
  google_rows_attempted: number;
  google_rows_response_ok: number;
  google_rows_accepted: number;
  google_enrichment_failures: Record<string, number>;
  google_match_rate: number | null;
  michelin_match_rate: number | null;
  warning_codes: WarningCode[];
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

function hasGoogleData(google: Restaurant["google"]) {
  return google.place_id !== null || google.rating !== null || google.review_count !== null;
}

function isLocalOrigin(origin: string) {
  const hostname = new URL(origin).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
}

async function fetchGoogleEnrichment(
  origin: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Response> {
  const jsonBody = JSON.stringify(body);
  const isLocal = isLocalOrigin(origin);

  // Deployed environments use direct handler invocation to avoid internal
  // self-fetch subrequests that count against platform limits (e.g. Cloudflare
  // Workers charge 2 subrequests per enrichment row when using self-fetch:
  // one for /api/google, one for the outbound maps.googleapis.com call).
  if (!isLocal) {
    try {
      return await googlePost(
        new Request("http://internal/api/google", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: jsonBody,
        }),
      );
    } catch {
      // Fall through to self-fetch as last resort.
    }
  }

  // Local dev and tests use self-fetch (compatible with fetch mock infrastructure).
  // Also serves as fallback if direct invocation throws in deployed environments.
  return fetch(`${origin}/api/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: jsonBody,
    signal,
    cache: "no-store",
  });
}

function roundMetric(value: number) {
  return Math.round(value * 100) / 100;
}

function ratioOrNull(numerator: number, denominator: number) {
  if (denominator <= 0) return null;
  return roundMetric(numerator / denominator);
}

function countWarningCodes(warnings: SearchWarning[]) {
  const counts: Record<string, number> = {};
  for (const warning of warnings) {
    counts[warning.code] = (counts[warning.code] ?? 0) + 1;
  }
  return counts;
}

function logSearchDiagnostics(diagnostics: SearchDiagnostics) {
  if (process.env.NODE_ENV !== "development") return;
  console.info("[search-diagnostics]", diagnostics);
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

async function googleOnlyFallback(
  city: string,
  context: { requestStartedAtMs: number; yelpStatus: string; yelpMs: number | null },
) {
  const googleStartedAtMs = Date.now();
  const fallback = await fetchGoogleFallbackRows(city);
  const googleMs = Date.now() - googleStartedAtMs;
  const scored = computeCombinedScores(fallback.restaurants);
  const accepted = scored.filter((restaurant) => hasGoogleData(restaurant.google)).length;
  const warningCodes = fallback.warnings.map((warning) => warning.code);
  const fallbackFailureCounts = countWarningCodes(fallback.warnings);

  logSearchDiagnostics({
    mode: "google_fallback",
    city,
    total_ms: Date.now() - context.requestStartedAtMs,
    yelp_status: context.yelpStatus,
    yelp_ms: context.yelpMs,
    google_ms: googleMs,
    google_rows_attempted: scored.length,
    google_rows_response_ok: scored.length,
    google_rows_accepted: accepted,
    google_enrichment_failures: fallbackFailureCounts,
    google_match_rate: ratioOrNull(accepted, scored.length),
    michelin_match_rate: null,
    warning_codes: warningCodes,
  });

  const response: SearchResponseSuccess = {
    city,
    restaurants: scored,
    warnings: fallback.warnings,
    google_only: true,
  };
  return NextResponse.json(response);
}

export async function POST(request: Request) {
  const requestStartedAtMs = Date.now();
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
  const isLocal = isLocalOrigin(origin);
  let yelpResponse: Response | null = null;
  let yelpMs: number | null = null;
  let yelpStatus = "unknown";
  const yelpStartedAtMs = Date.now();
  const yelpRequestBody = JSON.stringify({ city });

  if (isLocal) {
    try {
      yelpResponse = await fetch(`${origin}/api/yelp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: yelpRequestBody,
        cache: "no-store",
      });
      yelpMs = Date.now() - yelpStartedAtMs;
      yelpStatus = yelpResponse.ok ? "ok" : `http_${yelpResponse.status}`;
    } catch {
      // Fall through to direct invocation below.
    }

    if (!yelpResponse || !yelpResponse.ok) {
      try {
        const directResponse = await yelpPost(
          new Request("http://internal/api/yelp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: yelpRequestBody,
          }),
        );
        if (directResponse.ok) {
          yelpResponse = directResponse;
          yelpMs = Date.now() - yelpStartedAtMs;
          yelpStatus = "ok";
        } else if (!yelpResponse) {
          yelpResponse = directResponse;
          yelpMs = Date.now() - yelpStartedAtMs;
          yelpStatus = `http_${directResponse.status}`;
        }
      } catch {
        if (!yelpResponse) {
          yelpStatus = "network_error";
          return googleOnlyFallback(city, { requestStartedAtMs, yelpStatus, yelpMs });
        }
      }
    }
  } else {
    try {
      yelpResponse = await yelpPost(
        new Request("http://internal/api/yelp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: yelpRequestBody,
        }),
      );
      yelpMs = Date.now() - yelpStartedAtMs;
      yelpStatus = yelpResponse.ok ? "ok" : `http_${yelpResponse.status}`;
    } catch {
      // Fall through to self-fetch below if direct invocation fails.
    }

    if (!yelpResponse) {
      try {
        yelpResponse = await fetch(`${origin}/api/yelp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: yelpRequestBody,
          cache: "no-store",
        });
        yelpMs = Date.now() - yelpStartedAtMs;
        yelpStatus = yelpResponse.ok ? "ok" : `http_${yelpResponse.status}`;
      } catch {
        yelpStatus = "network_error";
        return googleOnlyFallback(city, { requestStartedAtMs, yelpStatus, yelpMs });
      }
    }
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
      logSearchDiagnostics({
        mode: "yelp_error",
        city,
        total_ms: Date.now() - requestStartedAtMs,
        yelp_status: code,
        yelp_ms: yelpMs,
        google_ms: null,
        google_rows_attempted: 0,
        google_rows_response_ok: 0,
        google_rows_accepted: 0,
        google_enrichment_failures: {},
        google_match_rate: null,
        michelin_match_rate: null,
        warning_codes: [],
      });
      return NextResponse.json(failureEnvelope(city, code, message), { status });
    }

    return googleOnlyFallback(city, { requestStartedAtMs, yelpStatus: code, yelpMs });
  }

  const yelpPayload = (await yelpResponse.json()) as { city: string; restaurants: YelpSeed[] };
  const restaurants = yelpPayload.restaurants.map((seed) => buildRestaurantFromSeed(seed));

  if (restaurants.length === 0) {
    return googleOnlyFallback(city, { requestStartedAtMs, yelpStatus: "zero_results", yelpMs });
  }

  const maxGoogleEnrichments = isLocal ? MAX_GOOGLE_ENRICHMENTS : DEPLOYED_MAX_GOOGLE_ENRICHMENTS;
  const targetCount = Math.min(restaurants.length, maxGoogleEnrichments);

  const warningCodes = new Set<WarningCode>();
  const googleFailureCodes: Record<string, number> = {};
  let googleAttempted = 0;
  let googleSucceeded = 0;
  let googleLatencyTotalMs = 0;
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
      const googleStartedAtMs = Date.now();
      googleAttempted += 1;

      try {
        const googleResponse = await fetchGoogleEnrichment(origin, {
          name: restaurant.name,
          city,
          lat: restaurant.yelp.lat,
          lng: restaurant.yelp.lng,
          address: restaurant.yelp.address ?? null,
          postal_code: restaurant.yelp.postal_code ?? null,
        }, timeout.signal);

        if (!googleResponse.ok) {
          warningCodes.add("GOOGLE_UPSTREAM_ERROR");
          googleFailureCodes.GOOGLE_UPSTREAM_ERROR = (googleFailureCodes.GOOGLE_UPSTREAM_ERROR ?? 0) + 1;
          continue;
        }

        const googlePayload = await googleResponse.json();
        if (!isGoogleRoutePayload(googlePayload)) {
          warningCodes.add("GOOGLE_UPSTREAM_ERROR");
          googleFailureCodes.GOOGLE_UPSTREAM_ERROR = (googleFailureCodes.GOOGLE_UPSTREAM_ERROR ?? 0) + 1;
          continue;
        }

        if (googlePayload.ok) {
          googleSucceeded += 1;
          restaurant.google = googlePayload.google;
        } else {
          restaurant.google = googlePayload.google;
          warningCodes.add(googlePayload.code);
          googleFailureCodes[googlePayload.code] = (googleFailureCodes[googlePayload.code] ?? 0) + 1;
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          warningCodes.add("GOOGLE_TIMEOUT");
          googleFailureCodes.GOOGLE_TIMEOUT = (googleFailureCodes.GOOGLE_TIMEOUT ?? 0) + 1;
        } else {
          warningCodes.add("GOOGLE_UPSTREAM_ERROR");
          googleFailureCodes.GOOGLE_UPSTREAM_ERROR = (googleFailureCodes.GOOGLE_UPSTREAM_ERROR ?? 0) + 1;
        }
      } finally {
        googleLatencyTotalMs += Date.now() - googleStartedAtMs;
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
  const googleAccepted = restaurants
    .slice(0, targetCount)
    .filter((restaurant) => hasGoogleData(restaurant.google)).length;
  const michelinMatchedCount = restaurantsWithMichelin.filter((restaurant) => restaurant.michelin.matched).length;

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

  logSearchDiagnostics({
    mode: "yelp_primary",
    city,
    total_ms: Date.now() - requestStartedAtMs,
    yelp_status: yelpStatus,
    yelp_ms: yelpMs,
    google_ms: googleAttempted > 0 ? roundMetric(googleLatencyTotalMs / googleAttempted) : null,
    google_rows_attempted: googleAttempted,
    google_rows_response_ok: googleSucceeded,
    google_rows_accepted: googleAccepted,
    google_enrichment_failures: googleFailureCodes,
    google_match_rate: ratioOrNull(googleAccepted, googleAttempted),
    michelin_match_rate: ratioOrNull(michelinMatchedCount, restaurantsWithMichelin.length),
    warning_codes: warnings.map((warning) => warning.code),
  });

  const response: SearchResponseSuccess = {
    city,
    restaurants: scoredRestaurants,
    warnings,
  };

  return NextResponse.json(response);
}
