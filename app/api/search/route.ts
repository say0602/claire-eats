import { NextResponse } from "next/server";
import type { Restaurant, SearchResponseFailure, SearchResponseSuccess, SearchWarning, WarningCode } from "@/lib/types";
import { getServerEnv } from "@/lib/env";
import { getServerAppProfile } from "@/lib/app-profile";
import {
  buildMapsUrl,
  getAddressSimilarity,
  getDistanceMeters,
  getNameSimilarity,
  hasNameOverlap,
  normalizePostalCode,
  rejectGoogleEnrichment,
} from "@/lib/matching";
import { matchMichelinForRestaurant } from "@/lib/michelin";
import { computeCombinedScores } from "@/lib/scoring";
import { POST as yelpPost } from "@/app/api/yelp/route";
import { POST as googlePost } from "@/app/api/google/route";

const MAX_GOOGLE_ENRICHMENTS = 50;
const GOOGLE_CONCURRENCY = 5;
const GOOGLE_REQUEST_TIMEOUT_MS = 3000;
const ENRICHMENT_BUDGET_MS =
  Math.ceil((MAX_GOOGLE_ENRICHMENTS / GOOGLE_CONCURRENCY) * GOOGLE_REQUEST_TIMEOUT_MS) + 1000;
const DEPLOYED_MAX_GOOGLE_ENRICHMENTS = 45;
const MERGED_RESULT_LIMIT = 80;
const MERGED_DEDUPE_DISTANCE_METERS = 250;
const GOOGLE_FALLBACK_LIMIT = 50;
const GOOGLE_FALLBACK_TIMEOUT_MS = 5000;
const GOOGLE_TEXT_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json";
const GOOGLE_PLACES_NEW_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const YELP_SEARCH_URL = "https://api.yelp.com/v3/businesses/search";
const GOOGLE_PROMINENT_PAGE_SIZE = 20;
const GOOGLE_PROMINENT_MAX_PAGES = 3;
const GOOGLE_PROMINENT_MAX_RESULTS = 60;
const GOOGLE_PROMINENT_PAGE_TOKEN_DELAY_MS = 2100;
const GOOGLE_PROMINENT_TOTAL_BUDGET_MS = 12_000;
const GOOGLE_PLACES_NEW_FIELD_MASK =
  "places.id,places.displayName,places.rating,places.userRatingCount,places.location,places.formattedAddress,places.types,nextPageToken";
const YELP_HARD_FAIL_CODES = new Set(["CONFIG_ERROR", "YELP_RATE_LIMITED", "YELP_TIMEOUT"]);
const GOOGLE_TYPE_SKIP = new Set(["point_of_interest", "establishment", "food", "restaurant"]);
const YELP_PROMINENT_MATCH_DISTANCE_METERS = 500;
const YELP_PROMINENT_REQUEST_TIMEOUT_MS = 1200;
const YELP_PROMINENT_LOOKUP_LIMIT_LOCAL = 30;
const YELP_PROMINENT_LOOKUP_LIMIT_DEPLOYED = 0;
const YELP_PROMINENT_BACKFILL_DELAY_MS = 120;
const YELP_RATE_LIMITED_SENTINEL = Symbol("YELP_RATE_LIMITED");

function devLog(...args: unknown[]) {
  if (process.env.NODE_ENV !== "development") return;
  // eslint-disable-next-line no-console
  console.log(...args);
}

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

type YelpBusinessSearchResult = {
  name?: string;
  rating?: number;
  review_count?: number;
  price?: string;
  categories?: Array<{ title?: string }>;
  coordinates?: { latitude?: number; longitude?: number };
  location?: {
    address1?: string;
    address2?: string;
    address3?: string;
    zip_code?: string;
    display_address?: string[];
  };
};

type YelpBusinessSearchResponse = {
  businesses?: YelpBusinessSearchResult[];
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

type GoogleProminentMetrics = {
  fetched: number;
  added: number;
  deduped: number;
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
  google_prominent_fetched: number;
  google_prominent_added: number;
  google_prominent_deduped: number;
  google_prominent_ms: number | null;
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

function toProfileRestaurants(restaurants: Restaurant[]) {
  if (getServerAppProfile() !== "public") return restaurants;
  return restaurants.map((restaurant) => ({
    ...restaurant,
    combined_score: null,
  }));
}

function shouldComputeCombinedScore() {
  return getServerAppProfile() !== "public";
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

function toYelpPriceTier(value: string | undefined): Restaurant["yelp"]["price"] {
  if (value === "$" || value === "$$" || value === "$$$" || value === "$$$$") return value;
  return null;
}

function parseYelpAddress(location: YelpBusinessSearchResult["location"]) {
  const displayAddress = location?.display_address
    ?.map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(", ");
  if (displayAddress) return displayAddress;

  const streetAddress = [location?.address1, location?.address2, location?.address3]
    .filter((line): line is string => typeof line === "string" && line.trim().length > 0)
    .map((line) => line.trim())
    .join(" ");
  return streetAddress || null;
}

function extractPostalCodeFromAddress(address: string | null | undefined) {
  return normalizePostalCode(address ?? null);
}

async function findYelpDataForProminentRestaurant(
  city: string,
  restaurant: Restaurant,
  yelpApiKey: string,
): Promise<Restaurant["yelp"] | null> {
  const searchUrl = new URL(YELP_SEARCH_URL);
  if (Number.isFinite(restaurant.yelp.lat) && Number.isFinite(restaurant.yelp.lng)) {
    searchUrl.searchParams.set("latitude", String(restaurant.yelp.lat));
    searchUrl.searchParams.set("longitude", String(restaurant.yelp.lng));
  } else {
    searchUrl.searchParams.set("location", city);
  }
  searchUrl.searchParams.set("term", restaurant.name);
  searchUrl.searchParams.set("limit", "10");

  const timeout = withTimeout(YELP_PROMINENT_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(searchUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${yelpApiKey}`,
        Accept: "application/json",
      },
      signal: timeout.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      devLog("[prominent-yelp] lookup failed", {
        city,
        name: restaurant.name,
        status: response.status,
      });
      if (response.status === 429) return YELP_RATE_LIMITED_SENTINEL as unknown as null;
      return null;
    }

    const payload = (await response.json()) as YelpBusinessSearchResponse;
    const candidates = (payload.businesses ?? [])
      .map((business) => {
        if (typeof business.rating !== "number" || typeof business.review_count !== "number") return null;
        const nameScore = getNameSimilarity(restaurant.name, business.name ?? "");
        if (nameScore < 0.35) return null;
        const lat = business.coordinates?.latitude;
        const lng = business.coordinates?.longitude;
        const hasCoords = typeof lat === "number" && typeof lng === "number";

        let distanceMeters: number | null = null;
        let distanceScore = 0;
        if (hasCoords) {
          distanceMeters = getDistanceMeters(
            { lat: restaurant.yelp.lat, lng: restaurant.yelp.lng },
            { lat, lng },
          );
          if (distanceMeters > YELP_PROMINENT_MATCH_DISTANCE_METERS) return null;
          distanceScore = 1 - distanceMeters / YELP_PROMINENT_MATCH_DISTANCE_METERS;
        }
        const yelpAddress = parseYelpAddress(business.location);
        const addressScore = getAddressSimilarity(
          yelpAddress,
          business.location?.zip_code ?? null,
          restaurant.yelp.address ?? null,
          restaurant.yelp.postal_code ?? null,
        );
        const score = nameScore * 0.55 + distanceScore * 0.25 + addressScore * 0.2;
        const hasStrongSignal = nameScore >= 0.5 || addressScore >= 0.7 || (nameScore >= 0.4 && distanceScore >= 0.4);
        if (!hasStrongSignal) return null;

        return {
          business,
          distanceMeters,
          score,
        };
      })
      .filter((candidate): candidate is { business: YelpBusinessSearchResult; distanceMeters: number | null; score: number } => candidate !== null)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const distanceA = a.distanceMeters ?? Number.POSITIVE_INFINITY;
        const distanceB = b.distanceMeters ?? Number.POSITIVE_INFINITY;
        if (distanceA !== distanceB) return distanceA - distanceB;
        return (b.business.review_count ?? 0) - (a.business.review_count ?? 0);
      });

    const best = candidates[0]?.business;
    if (!best || typeof best.rating !== "number" || typeof best.review_count !== "number") {
      return null;
    }

    return {
      rating: best.rating,
      review_count: best.review_count,
      price: toYelpPriceTier(best.price),
      categories: (best.categories ?? [])
        .map((category) => category.title?.trim())
        .filter((title): title is string => Boolean(title)),
      lat: typeof best.coordinates?.latitude === "number" ? best.coordinates.latitude : restaurant.yelp.lat,
      lng: typeof best.coordinates?.longitude === "number" ? best.coordinates.longitude : restaurant.yelp.lng,
      address: parseYelpAddress(best.location),
      postal_code:
        typeof best.location?.zip_code === "string" && best.location.zip_code.trim().length > 0
          ? best.location.zip_code.trim()
          : null,
    };
  } catch {
    return null;
  } finally {
    timeout.clear();
  }
}

async function backfillProminentRowsWithYelpData(
  city: string,
  prominentRows: Restaurant[],
  isLocal: boolean,
) {
  if (prominentRows.length === 0) return;

  let yelpApiKey: string;
  try {
    yelpApiKey = getServerEnv().YELP_API_KEY;
  } catch {
    return;
  }

  const lookupLimit = isLocal ? YELP_PROMINENT_LOOKUP_LIMIT_LOCAL : YELP_PROMINENT_LOOKUP_LIMIT_DEPLOYED;
  const targetRows = prominentRows.slice(0, Math.min(lookupLimit, prominentRows.length));
  if (targetRows.length === 0) return;

  let backfilledCount = 0;
  let rateLimited = false;

  for (let i = 0; i < targetRows.length; i += 1) {
    if (i > 0 && process.env.NODE_ENV !== "test") {
      await new Promise((resolve) => setTimeout(resolve, YELP_PROMINENT_BACKFILL_DELAY_MS));
    }
    const restaurant = targetRows[i];
    const yelpData = await findYelpDataForProminentRestaurant(city, restaurant, yelpApiKey);
    if (yelpData === (YELP_RATE_LIMITED_SENTINEL as unknown)) {
      rateLimited = true;
      devLog("[prominent-yelp] rate-limited, stopping backfill", {
        city,
        completed: i,
        remaining: targetRows.length - i,
      });
      break;
    }
    if (!yelpData) continue;
    restaurant.yelp = yelpData;
    backfilledCount += 1;
  }

  devLog("[prominent-yelp] done", {
    city,
    attempted: rateLimited ? backfilledCount : targetRows.length,
    matched: backfilledCount,
    skipped: prominentRows.length - targetRows.length,
    rate_limited: rateLimited,
  });
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

type GooglePlacesNewResult = {
  id?: string;
  displayName?: { text?: string };
  // Places API (New) uses `rating`; `userRating` is kept for backwards compatibility
  // with earlier mocks/tests and potential upstream changes.
  rating?: number;
  userRating?: number;
  userRatingCount?: number;
  location?: { latitude?: number; longitude?: number };
  formattedAddress?: string;
  types?: string[];
};

type GooglePlacesNewResponse = {
  places?: GooglePlacesNewResult[];
  nextPageToken?: string;
};

type GooglePlacesNewErrorResponse = {
  error?: {
    status?: string;
    message?: string;
  };
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

function buildRestaurantFromGooglePlacesNewResult(
  result: GooglePlacesNewResult,
  city: string,
  index: number,
  idPrefix = "google-fallback",
): Restaurant {
  const placeId = result.id ?? null;
  const lat = result.location?.latitude ?? 0;
  const lng = result.location?.longitude ?? 0;
  const address = result.formattedAddress?.trim() || null;
  const rating =
    typeof result.rating === "number"
      ? result.rating
      : typeof result.userRating === "number"
        ? result.userRating
        : null;

  return {
    id: `${idPrefix}-${index}`,
    name: result.displayName?.text ?? "Unknown",
    city,
    yelp: {
      rating: 0,
      review_count: 0,
      price: null,
      categories: categoriesFromTypes(result.types),
      lat,
      lng,
      address,
      postal_code: extractPostalCodeFromAddress(address),
    },
    google: {
      rating,
      review_count: result.userRatingCount ?? null,
      place_id: placeId,
      maps_url: buildMapsUrl(placeId),
    },
    michelin: { award: null, green_star: false, matched: false },
    combined_score: null,
  };
}

function hasValidCoordinates(restaurant: Restaurant) {
  return Number.isFinite(restaurant.yelp.lat) && Number.isFinite(restaurant.yelp.lng);
}

function prominentSelfDedupeKey(restaurant: Restaurant) {
  const normalizedName = restaurant.name.trim().toLowerCase();
  const lat = Number.isFinite(restaurant.yelp.lat) ? restaurant.yelp.lat.toFixed(4) : "na";
  const lng = Number.isFinite(restaurant.yelp.lng) ? restaurant.yelp.lng.toFixed(4) : "na";
  return `${normalizedName}|${lat}|${lng}`;
}

function isLikelyProminentDuplicate(yelpRestaurant: Restaurant, prominentRestaurant: Restaurant) {
  if (!hasNameOverlap(yelpRestaurant.name, prominentRestaurant.name)) return false;
  if (!hasValidCoordinates(yelpRestaurant) || !hasValidCoordinates(prominentRestaurant)) return false;

  const distanceMeters = getDistanceMeters(
    { lat: yelpRestaurant.yelp.lat, lng: yelpRestaurant.yelp.lng },
    { lat: prominentRestaurant.yelp.lat, lng: prominentRestaurant.yelp.lng },
  );
  return distanceMeters <= MERGED_DEDUPE_DISTANCE_METERS;
}

function dedupeProminentAgainstYelp(yelpRows: Restaurant[], prominentRows: Restaurant[]) {
  const yelpPlaceIds = new Set(
    yelpRows
      .map((restaurant) => restaurant.google.place_id)
      .filter((placeId): placeId is string => typeof placeId === "string" && placeId.length > 0),
  );
  const uniqueProminentRows: Restaurant[] = [];
  const seenProminentRows = new Set<string>();
  const seenProminentPlaceIds = new Set<string>();

  for (const prominentRow of prominentRows) {
    if (prominentRow.google.place_id) {
      if (seenProminentPlaceIds.has(prominentRow.google.place_id)) continue;
      seenProminentPlaceIds.add(prominentRow.google.place_id);
    }

    const prominentKey = prominentSelfDedupeKey(prominentRow);
    if (seenProminentRows.has(prominentKey)) continue;

    if (prominentRow.google.place_id && yelpPlaceIds.has(prominentRow.google.place_id)) {
      continue;
    }

    const hasNameAndGeoMatch = yelpRows.some((yelpRow) => isLikelyProminentDuplicate(yelpRow, prominentRow));
    if (hasNameAndGeoMatch) continue;
    seenProminentRows.add(prominentKey);
    uniqueProminentRows.push(prominentRow);
  }

  return uniqueProminentRows;
}

function dedupeWarnings(warnings: SearchWarning[]) {
  const seen = new Set<WarningCode>();
  const deduped: SearchWarning[] = [];
  for (const warning of warnings) {
    if (seen.has(warning.code)) continue;
    seen.add(warning.code);
    deduped.push(warning);
  }
  return deduped;
}

function googleFallbackMergeKey(restaurant: Restaurant) {
  if (restaurant.google.place_id) return restaurant.google.place_id;
  return [
    restaurant.name,
    restaurant.yelp.lat,
    restaurant.yelp.lng,
    restaurant.google.rating ?? "",
    restaurant.google.review_count ?? "",
  ].join("|");
}

function mergeGoogleFallbackRestaurants(
  prominentRows: Restaurant[],
  legacyRows: Restaurant[],
  limit: number,
) {
  const merged: Restaurant[] = [];
  const seen = new Set<string>();

  for (const restaurant of [...prominentRows, ...legacyRows]) {
    const key = googleFallbackMergeKey(restaurant);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(restaurant);
    if (merged.length >= limit) break;
  }

  return merged;
}

async function waitForProminentPageToken() {
  if (process.env.NODE_ENV === "test") return;
  await new Promise((resolve) => setTimeout(resolve, GOOGLE_PROMINENT_PAGE_TOKEN_DELAY_MS));
}

async function fetchGoogleProminentRows(
  city: string,
  options?: { resultLimit?: number; idPrefix?: string },
): Promise<{ restaurants: Restaurant[]; warnings: SearchWarning[] }> {
  let apiKey: string;
  try {
    apiKey = getServerEnv().GOOGLE_MAPS_API_KEY;
  } catch {
    return { restaurants: [], warnings: [{ code: "GOOGLE_UPSTREAM_ERROR", message: "Google API key is not configured." }] };
  }

  const resultLimit = options?.resultLimit ?? GOOGLE_FALLBACK_LIMIT;
  const idPrefix = options?.idPrefix ?? "google-fallback";

  const places: GooglePlacesNewResult[] = [];
  let nextPageToken: string | undefined;
  let warningCode: WarningCode | null = null;
  let warningMessageText: string | null = null;
  const prominentDeadlineMs = Date.now() + GOOGLE_PROMINENT_TOTAL_BUDGET_MS;

  pageLoop: for (let page = 0; page < GOOGLE_PROMINENT_MAX_PAGES; page += 1) {
    if (Date.now() > prominentDeadlineMs) {
      warningCode = "GOOGLE_TIMEOUT";
      warningMessageText = "Google prominent fallback search timed out.";
      break;
    }
    if (page > 0 && !nextPageToken) break;
    if (page > 0) {
      await waitForProminentPageToken();
      if (Date.now() > prominentDeadlineMs) {
        warningCode = "GOOGLE_TIMEOUT";
        warningMessageText = "Google prominent fallback search timed out.";
        break;
      }
    }

    const maxAttempts = page > 0 ? 2 : 1;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const remainingBudgetMs = prominentDeadlineMs - Date.now();
      if (remainingBudgetMs <= 0) {
        warningCode = "GOOGLE_TIMEOUT";
        warningMessageText = "Google prominent fallback search timed out.";
        break pageLoop;
      }
      const timeout = withTimeout(Math.min(GOOGLE_FALLBACK_TIMEOUT_MS, remainingBudgetMs));
      try {
        const payload: Record<string, unknown> = {
          textQuery: `restaurants in ${city}`,
          pageSize: GOOGLE_PROMINENT_PAGE_SIZE,
        };
        if (nextPageToken) {
          payload.pageToken = nextPageToken;
        }

        const response = await fetch(GOOGLE_PLACES_NEW_TEXT_SEARCH_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": GOOGLE_PLACES_NEW_FIELD_MASK,
          },
          body: JSON.stringify(payload),
          signal: timeout.signal,
          cache: "no-store",
        });

        if (!response.ok) {
          const errorPayload = (await response.json().catch(() => null)) as GooglePlacesNewErrorResponse | null;
          const errorStatus = errorPayload?.error?.status;
          devLog("[prominent] failed", {
            city,
            page,
            attempt,
            http_status: response.status,
            error_status: errorStatus ?? null,
            message: errorPayload?.error?.message ?? null,
          });
          const shouldRetryToken =
            page > 0 &&
            attempt === 0 &&
            response.status === 400 &&
            (errorStatus === "INVALID_ARGUMENT" || errorStatus === "INVALID_REQUEST");
          if (shouldRetryToken) {
            await waitForProminentPageToken();
            continue;
          }

          warningCode = response.status === 429 ? "GOOGLE_RATE_LIMITED" : "GOOGLE_UPSTREAM_ERROR";
          warningMessageText = "Google prominent fallback search failed.";
          break pageLoop;
        }

        const result = (await response.json()) as GooglePlacesNewResponse;
        devLog("[prominent] ok", {
          city,
          page,
          received: result.places?.length ?? 0,
          has_next_page_token: typeof result.nextPageToken === "string" && result.nextPageToken.trim().length > 0,
        });
        if (result.places?.length) {
          places.push(...result.places);
        }
        nextPageToken = typeof result.nextPageToken === "string" && result.nextPageToken.trim().length > 0
          ? result.nextPageToken
          : undefined;
        if (places.length >= GOOGLE_PROMINENT_MAX_RESULTS) break pageLoop;
        break;
      } catch (error) {
        devLog("[prominent] exception", {
          city,
          page,
          attempt,
          name: error instanceof Error ? error.name : null,
          message: error instanceof Error ? error.message : String(error),
        });
        warningCode = error instanceof Error && error.name === "AbortError" ? "GOOGLE_TIMEOUT" : "GOOGLE_UPSTREAM_ERROR";
        warningMessageText = "Google prominent fallback search failed.";
        break pageLoop;
      } finally {
        timeout.clear();
      }
    }
  }

  const dedupedPlaces = Array.from(
    new Map(
      places.map((place, index) => [place.id ?? `${place.displayName?.text ?? "unknown"}-${index}`, place]),
    ).values(),
  ).slice(0, GOOGLE_PROMINENT_MAX_RESULTS);

  const restaurants = dedupedPlaces
    .slice(0, resultLimit)
    .map((result, i) => buildRestaurantFromGooglePlacesNewResult(result, city, i, idPrefix));

  const warnings =
    warningCode && warningMessageText
      ? [{ code: warningCode, message: warningMessageText }]
      : [];

  devLog("[prominent] done", {
    city,
    fetched_places: places.length,
    deduped_places: dedupedPlaces.length,
    returned_restaurants: restaurants.length,
    warning_code: warningCode,
  });

  return { restaurants, warnings };
}

async function fetchGoogleFallbackRowsLegacy(city: string): Promise<{ restaurants: Restaurant[]; warnings: SearchWarning[] }> {
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

async function fetchGoogleFallbackRows(
  city: string,
  prefetchedProminent?: { restaurants: Restaurant[]; warnings: SearchWarning[] },
): Promise<{ restaurants: Restaurant[]; warnings: SearchWarning[]; prominent: GoogleProminentMetrics }> {
  const normalizeFallbackPrefetchIds = (restaurants: Restaurant[]) =>
    restaurants.map((restaurant, index) => ({
      ...restaurant,
      id: `google-fallback-${index}`,
    }));

  const prominentSource = prefetchedProminent
    ? {
      restaurants: normalizeFallbackPrefetchIds(
        prefetchedProminent.restaurants.slice(0, GOOGLE_FALLBACK_LIMIT),
      ),
      warnings: prefetchedProminent.warnings,
    }
    : await fetchGoogleProminentRows(city);
  const prominent = prominentSource;
  const prominentFetched = prominentSource.restaurants.length;
  if (prominent.restaurants.length >= GOOGLE_FALLBACK_LIMIT && prominent.warnings.length === 0) {
    return {
      restaurants: prominent.restaurants,
      warnings: prominent.warnings,
      prominent: {
        fetched: prominentFetched,
        added: prominent.restaurants.length,
        deduped: Math.max(0, prominentFetched - prominent.restaurants.length),
      },
    };
  }

  const legacy = await fetchGoogleFallbackRowsLegacy(city);
  if (prominent.restaurants.length === 0 && (legacy.restaurants.length > 0 || legacy.warnings.length === 0)) {
    return {
      restaurants: legacy.restaurants,
      warnings: legacy.warnings,
      prominent: {
        fetched: prominentFetched,
        added: 0,
        deduped: prominentFetched,
      },
    };
  }

  if (prominent.restaurants.length > 0 && legacy.restaurants.length > 0) {
    const mergedRestaurants = mergeGoogleFallbackRestaurants(
      prominent.restaurants,
      legacy.restaurants,
      GOOGLE_FALLBACK_LIMIT,
    );
    const hasFullMergedSet = mergedRestaurants.length >= GOOGLE_FALLBACK_LIMIT;
    const mergedWarnings = hasFullMergedSet && legacy.warnings.length === 0
      ? []
      : dedupeWarnings([...prominent.warnings, ...legacy.warnings]);
    return {
      restaurants: mergedRestaurants,
      warnings: mergedWarnings,
      prominent: {
        fetched: prominentFetched,
        added: Math.min(prominent.restaurants.length, mergedRestaurants.length),
        deduped: Math.max(0, prominentFetched - Math.min(prominent.restaurants.length, mergedRestaurants.length)),
      },
    };
  }

  if (prominent.restaurants.length > 0) {
    return {
      restaurants: prominent.restaurants.slice(0, GOOGLE_FALLBACK_LIMIT),
      warnings: dedupeWarnings(prominent.warnings),
      prominent: {
        fetched: prominentFetched,
        added: prominent.restaurants.slice(0, GOOGLE_FALLBACK_LIMIT).length,
        deduped: Math.max(0, prominentFetched - prominent.restaurants.slice(0, GOOGLE_FALLBACK_LIMIT).length),
      },
    };
  }

  return {
    restaurants: [],
    warnings: dedupeWarnings([...legacy.warnings, ...prominent.warnings]),
    prominent: {
      fetched: prominentFetched,
      added: 0,
      deduped: prominentFetched,
    },
  };
}

async function googleOnlyFallback(
  city: string,
  context: { requestStartedAtMs: number; yelpStatus: string; yelpMs: number | null },
  prefetchedProminent?: { restaurants: Restaurant[]; warnings: SearchWarning[] },
  prefetchedProminentMs?: number | null,
) {
  const googleStartedAtMs = Date.now();
  const fallback = await fetchGoogleFallbackRows(city, prefetchedProminent);
  const googleMs = Date.now() - googleStartedAtMs;
  const scored = shouldComputeCombinedScore() ? computeCombinedScores(fallback.restaurants) : fallback.restaurants;
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
    google_prominent_fetched: fallback.prominent.fetched,
    google_prominent_added: fallback.prominent.added,
    google_prominent_deduped: fallback.prominent.deduped,
    google_prominent_ms: prefetchedProminentMs ?? null,
    warning_codes: warningCodes,
  });

  const response: SearchResponseSuccess = {
    city,
    restaurants: toProfileRestaurants(scored),
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

  const prominentPromise = fetchGoogleProminentRows(city, {
    resultLimit: GOOGLE_PROMINENT_MAX_RESULTS,
    idPrefix: "google-prominent",
  })
    .then((result) => ({ result, finishedAtMs: Date.now() }))
    .catch(() => ({ result: { restaurants: [], warnings: [] }, finishedAtMs: Date.now() }));
  const prominentStartedAtMs = Date.now();

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
          const prominentOutcome = await prominentPromise;
          const prefetchedProminent = prominentOutcome.result;
          const prefetchedProminentMs = prominentOutcome.finishedAtMs - prominentStartedAtMs;
          return googleOnlyFallback(
            city,
            { requestStartedAtMs, yelpStatus, yelpMs },
            prefetchedProminent,
            prefetchedProminentMs,
          );
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
        const prominentOutcome = await prominentPromise;
        const prefetchedProminent = prominentOutcome.result;
        const prefetchedProminentMs = prominentOutcome.finishedAtMs - prominentStartedAtMs;
        return googleOnlyFallback(
          city,
          { requestStartedAtMs, yelpStatus, yelpMs },
          prefetchedProminent,
          prefetchedProminentMs,
        );
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
        google_prominent_fetched: 0,
        google_prominent_added: 0,
        google_prominent_deduped: 0,
        google_prominent_ms: null,
        warning_codes: [],
      });
      return NextResponse.json(failureEnvelope(city, code, message), { status });
    }

    const prominentOutcome = await prominentPromise;
    const prefetchedProminent = prominentOutcome.result;
    const prefetchedProminentMs = prominentOutcome.finishedAtMs - prominentStartedAtMs;
    return googleOnlyFallback(
      city,
      { requestStartedAtMs, yelpStatus: code, yelpMs },
      prefetchedProminent,
      prefetchedProminentMs,
    );
  }

  const yelpPayload = (await yelpResponse.json()) as { city: string; restaurants: YelpSeed[] };
  const restaurants = yelpPayload.restaurants.map((seed) => buildRestaurantFromSeed(seed));

  if (restaurants.length === 0) {
    const prominentOutcome = await prominentPromise;
    const prefetchedProminent = prominentOutcome.result;
    const prefetchedProminentMs = prominentOutcome.finishedAtMs - prominentStartedAtMs;
    return googleOnlyFallback(
      city,
      { requestStartedAtMs, yelpStatus: "zero_results", yelpMs },
      prefetchedProminent,
      prefetchedProminentMs,
    );
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

  const scoredRestaurants = shouldComputeCombinedScore() ? computeCombinedScores(restaurantsWithMichelin) : restaurantsWithMichelin;
  const prominentOutcome = await prominentPromise;
  const prominent = prominentOutcome.result;
  const prominentMs = prominentOutcome.finishedAtMs - prominentStartedAtMs;
  const prominentUniqueRows = dedupeProminentAgainstYelp(restaurants, prominent.restaurants);
  await backfillProminentRowsWithYelpData(city, prominentUniqueRows, isLocal);
  const prominentRowsWithMichelin = prominentUniqueRows.map((restaurant) => ({
    ...restaurant,
    michelin: matchMichelinForRestaurant({
      city: restaurant.city,
      lat: restaurant.yelp.lat,
      lng: restaurant.yelp.lng,
    }),
  }));
  const scoredProminentRows = shouldComputeCombinedScore() ? computeCombinedScores(prominentRowsWithMichelin) : prominentRowsWithMichelin;
  const mergedRestaurants = [...scoredRestaurants, ...scoredProminentRows].slice(0, MERGED_RESULT_LIMIT);
  const prominentFetched = prominent.restaurants.length;
  const prominentAdded = scoredProminentRows.length;
  const prominentDeduped = Math.max(0, prominentFetched - prominentAdded);
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
    google_prominent_fetched: prominentFetched,
    google_prominent_added: prominentAdded,
    google_prominent_deduped: prominentDeduped,
    google_prominent_ms: prominentMs,
    warning_codes: warnings.map((warning) => warning.code),
  });

  const response: SearchResponseSuccess = {
    city,
    restaurants: toProfileRestaurants(mergedRestaurants),
    warnings,
  };

  return NextResponse.json(response);
}
