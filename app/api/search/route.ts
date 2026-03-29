import { NextResponse } from "next/server";
import type { Restaurant, SearchResponseFailure, SearchResponseSuccess, SearchWarning, WarningCode } from "@/lib/types";
import { getServerEnv } from "@/lib/env";
import { getServerAppProfile, type AppProfile } from "@/lib/app-profile";
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
const YELP_PROMINENT_LOOKUP_LIMIT_DEPLOYED_DEFAULT = 30;
const YELP_PROMINENT_BACKFILL_DELAY_MS_LOCAL = 120;
const YELP_PROMINENT_BACKFILL_DELAY_MS_DEPLOYED_DEFAULT = 700;
const YELP_PROMINENT_RATE_LIMIT_RETRY_DELAY_MS_DEPLOYED_DEFAULT = 2500;
const YELP_PROMINENT_MAX_CONSECUTIVE_429_DEPLOYED_DEFAULT = 20;
const YELP_PROMINENT_BACKFILL_BUDGET_MS_DEFAULT = 30_000;
const YELP_RATE_LIMITED_SENTINEL = Symbol("YELP_RATE_LIMITED");
const DYNAMIC_CITY_CACHE_VERSION_DEFAULT = "phase-h-v1";
const DYNAMIC_CITY_CACHE_TTL_COLD_MINUTES_DEFAULT = 20;
const DYNAMIC_CITY_CACHE_TTL_HOT_MINUTES_DEFAULT = 60;
const DYNAMIC_CITY_CACHE_HOT_HIT_THRESHOLD_DEFAULT = 3;
const DYNAMIC_CITY_CACHE_MAX_ENTRIES_DEFAULT = 200;
const SNAPSHOT_VERSION_DEFAULT = "pilot-v1";
const SNAPSHOT_MAX_AGE_MINUTES_DEFAULT = 24 * 60;
const SNAPSHOT_MANIFEST_CACHE_TTL_MS = 60_000;
const SNAPSHOT_ALLOW_STALE_PUBLIC_DEFAULT = true;

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
  mode: "yelp_primary" | "google_fallback" | "yelp_error" | "snapshot" | "cache";
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
  snapshot_served: boolean;
  snapshot_age_minutes: number | null;
  google_prefill_matches: number;
  yelp_backfill_attempted: number;
  yelp_backfill_matched: number;
  yelp_backfill_skipped_budget: number;
  yelp_backfill_skipped_lookup_cap?: number;
  yelp_backfill_skipped_time_budget?: number;
  yelp_backfill_skipped_rate_limit_stop?: number;
  yelp_backfill_skipped_no_api_key?: number;
  cache_hit?: boolean;
  cache_write?: boolean;
  cache_write_skipped_reason?: "warnings" | "degraded" | null;
  cache_ttl_minutes?: number | null;
  request_budget_mode: "normal" | "degraded";
  warning_codes: WarningCode[];
};

type YelpBackfillMetrics = {
  attempted: number;
  matched: number;
  skipped_budget: number;
  skipped_lookup_cap: number;
  skipped_time_budget: number;
  skipped_rate_limit_stop: number;
  skipped_no_api_key: number;
};

type SearchProfilePolicy = {
  maxGoogleEnrichments: number;
  yelpProminentLookupLimit: number;
  yelpProminentBackfillDelayMs: number;
  yelpProminentRateLimitRetryDelayMs: number;
  yelpProminentMaxConsecutive429: number;
  yelpProminentBackfillBudgetMs: number;
};

type DynamicCityCacheValue = {
  city: string;
  restaurants: Restaurant[];
  warnings: SearchWarning[];
  google_only?: boolean;
};

type DynamicCityCacheEntry = {
  value: DynamicCityCacheValue;
  expiresAtMs: number;
};

type SnapshotManifestEntry = {
  city: string;
  slug: string;
};

type SnapshotManifestCache = {
  version: string;
  expiresAtMs: number;
  value: { finishedAtUtc: string | null; entries: SnapshotManifestEntry[] } | null;
};

let snapshotManifestCache: SnapshotManifestCache | null = null;
const dynamicCityCache = new Map<string, DynamicCityCacheEntry>();
const dynamicCityCacheHitCounts = new Map<string, number>();

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

function getDeployedProminentLookupLimit() {
  const raw = process.env.YELP_PROMINENT_LOOKUP_LIMIT_DEPLOYED;
  if (!raw) return YELP_PROMINENT_LOOKUP_LIMIT_DEPLOYED_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return YELP_PROMINENT_LOOKUP_LIMIT_DEPLOYED_DEFAULT;
  return Math.max(0, Math.floor(parsed));
}

function parseNonNegativeIntegerEnv(raw: string | undefined, fallback: number) {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
}

function getProminentBackfillDelayMs(isLocal: boolean) {
  if (isLocal) return YELP_PROMINENT_BACKFILL_DELAY_MS_LOCAL;
  return parseNonNegativeIntegerEnv(
    process.env.YELP_PROMINENT_BACKFILL_DELAY_MS_DEPLOYED,
    YELP_PROMINENT_BACKFILL_DELAY_MS_DEPLOYED_DEFAULT,
  );
}

function getProminentRateLimitRetryDelayMs(isLocal: boolean) {
  if (isLocal) return 0;
  return parseNonNegativeIntegerEnv(
    process.env.YELP_PROMINENT_RATE_LIMIT_RETRY_DELAY_MS_DEPLOYED,
    YELP_PROMINENT_RATE_LIMIT_RETRY_DELAY_MS_DEPLOYED_DEFAULT,
  );
}

function getProminentMaxConsecutive429(isLocal: boolean) {
  if (isLocal) return 1;
  return parseNonNegativeIntegerEnv(
    process.env.YELP_PROMINENT_MAX_CONSECUTIVE_429_DEPLOYED,
    YELP_PROMINENT_MAX_CONSECUTIVE_429_DEPLOYED_DEFAULT,
  );
}

function getProminentLookupLimit(isLocal: boolean, appProfile: AppProfile) {
  const baseLimit = isLocal ? YELP_PROMINENT_LOOKUP_LIMIT_LOCAL : getDeployedProminentLookupLimit();
  if (appProfile !== "public") return baseLimit;
  const publicLimit = parseNonNegativeIntegerEnv(process.env.YELP_PROMINENT_LOOKUP_LIMIT_PUBLIC, baseLimit);
  return Math.min(baseLimit, publicLimit);
}

function getProminentBackfillBudgetMs() {
  return parseNonNegativeIntegerEnv(
    process.env.YELP_PROMINENT_BACKFILL_BUDGET_MS,
    YELP_PROMINENT_BACKFILL_BUDGET_MS_DEFAULT,
  );
}

function buildSearchProfilePolicy(isLocal: boolean, appProfile: AppProfile): SearchProfilePolicy {
  const maxGoogleEnrichments = isLocal ? MAX_GOOGLE_ENRICHMENTS : DEPLOYED_MAX_GOOGLE_ENRICHMENTS;
  return {
    maxGoogleEnrichments,
    yelpProminentLookupLimit: getProminentLookupLimit(isLocal, appProfile),
    yelpProminentBackfillDelayMs: getProminentBackfillDelayMs(isLocal),
    yelpProminentRateLimitRetryDelayMs: getProminentRateLimitRetryDelayMs(isLocal),
    yelpProminentMaxConsecutive429: getProminentMaxConsecutive429(isLocal),
    yelpProminentBackfillBudgetMs: getProminentBackfillBudgetMs(),
  };
}

function toCitySlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseSnapshotEnabled() {
  if (process.env.NODE_ENV === "test") {
    return process.env.SEARCH_SNAPSHOT_PUBLIC_ENABLED === "1";
  }
  const raw = process.env.SEARCH_SNAPSHOT_PUBLIC_ENABLED;
  if (!raw) return true;
  const normalized = raw.trim().toLowerCase();
  if (["0", "false", "off", "no"].includes(normalized)) return false;
  if (["1", "true", "on", "yes"].includes(normalized)) return true;
  return true;
}

function parseDynamicCityCacheEnabled() {
  if (process.env.NODE_ENV === "test") {
    return process.env.SEARCH_DYNAMIC_CITY_CACHE_ENABLED === "1";
  }
  const raw = process.env.SEARCH_DYNAMIC_CITY_CACHE_ENABLED;
  if (!raw) return true;
  const normalized = raw.trim().toLowerCase();
  if (["0", "false", "off", "no"].includes(normalized)) return false;
  if (["1", "true", "on", "yes"].includes(normalized)) return true;
  return true;
}

function getDynamicCityCacheVersion() {
  const raw = process.env.SEARCH_DYNAMIC_CITY_CACHE_VERSION?.trim();
  return raw && raw.length > 0 ? raw : DYNAMIC_CITY_CACHE_VERSION_DEFAULT;
}

function getDynamicCityCacheColdTtlMinutes() {
  return parseNonNegativeIntegerEnv(
    process.env.SEARCH_DYNAMIC_CITY_CACHE_TTL_COLD_MINUTES,
    DYNAMIC_CITY_CACHE_TTL_COLD_MINUTES_DEFAULT,
  );
}

function getDynamicCityCacheHotTtlMinutes() {
  return parseNonNegativeIntegerEnv(
    process.env.SEARCH_DYNAMIC_CITY_CACHE_TTL_HOT_MINUTES,
    DYNAMIC_CITY_CACHE_TTL_HOT_MINUTES_DEFAULT,
  );
}

function getDynamicCityCacheHotHitThreshold() {
  return parseNonNegativeIntegerEnv(
    process.env.SEARCH_DYNAMIC_CITY_CACHE_HOT_HIT_THRESHOLD,
    DYNAMIC_CITY_CACHE_HOT_HIT_THRESHOLD_DEFAULT,
  );
}

function getDynamicCityCacheMaxEntries() {
  return parseNonNegativeIntegerEnv(
    process.env.SEARCH_DYNAMIC_CITY_CACHE_MAX_ENTRIES,
    DYNAMIC_CITY_CACHE_MAX_ENTRIES_DEFAULT,
  );
}

function buildDynamicCityCacheKey(city: string, appProfile: AppProfile, version: string) {
  return `${version}:${appProfile}:${toCitySlug(city)}`;
}

function pruneDynamicCityCache(maxEntries: number) {
  const nowMs = Date.now();
  for (const [key, entry] of dynamicCityCache.entries()) {
    if (entry.expiresAtMs <= nowMs) {
      dynamicCityCache.delete(key);
      dynamicCityCacheHitCounts.delete(key);
    }
  }

  if (maxEntries <= 0) {
    dynamicCityCache.clear();
    dynamicCityCacheHitCounts.clear();
    return;
  }

  while (dynamicCityCache.size >= maxEntries) {
    const oldestKey = dynamicCityCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    dynamicCityCache.delete(oldestKey);
    dynamicCityCacheHitCounts.delete(oldestKey);
  }
}

function tryGetDynamicCityCache(city: string, appProfile: AppProfile): DynamicCityCacheValue | null {
  if (!parseDynamicCityCacheEnabled()) return null;
  pruneDynamicCityCache(getDynamicCityCacheMaxEntries());
  const key = buildDynamicCityCacheKey(city, appProfile, getDynamicCityCacheVersion());
  const entry = dynamicCityCache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAtMs) {
    dynamicCityCache.delete(key);
    dynamicCityCacheHitCounts.delete(key);
    return null;
  }
  const hitCount = (dynamicCityCacheHitCounts.get(key) ?? 0) + 1;
  dynamicCityCacheHitCounts.set(key, hitCount);
  return entry.value;
}

function maybeSetDynamicCityCache(city: string, appProfile: AppProfile, value: DynamicCityCacheValue) {
  if (!parseDynamicCityCacheEnabled()) return;
  const key = buildDynamicCityCacheKey(city, appProfile, getDynamicCityCacheVersion());
  const hitCount = dynamicCityCacheHitCounts.get(key) ?? 0;
  const hotThreshold = getDynamicCityCacheHotHitThreshold();
  const coldTtlMinutes = getDynamicCityCacheColdTtlMinutes();
  const hotTtlMinutes = getDynamicCityCacheHotTtlMinutes();
  const ttlMinutes = hitCount >= hotThreshold ? hotTtlMinutes : coldTtlMinutes;
  const ttlMs = Math.max(0, ttlMinutes * 60_000);
  pruneDynamicCityCache(getDynamicCityCacheMaxEntries());
  dynamicCityCache.set(key, {
    value,
    expiresAtMs: Date.now() + ttlMs,
  });
  return ttlMinutes;
}

function shouldWriteDynamicCityCache(
  response: SearchResponseSuccess,
  requestBudgetMode: "normal" | "degraded" = "normal",
) {
  if (response.warnings.length > 0) return { write: false, reason: "warnings" as const };
  if (requestBudgetMode !== "normal") return { write: false, reason: "degraded" as const };
  return { write: true, reason: null };
}

function getCacheDiagnostics(write: boolean, reason: "warnings" | "degraded" | null, ttlMinutes: number | null) {
  return {
    cache_hit: false,
    cache_write: write,
    cache_write_skipped_reason: reason,
    cache_ttl_minutes: ttlMinutes,
  };
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "\"") {
      const next = line[i + 1];
      if (inQuotes && next === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function parseNumber(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBooleanString(value: string | undefined) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function parsePlaceIdFromMapsUrl(url: string | null) {
  if (!url) return null;
  const match = /[?&]q=place_id:([^&]+)/.exec(url);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

async function tryReadFile(filePath: string) {
  try {
    const fs = await import("node:fs/promises");
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function normalizeBaseUrl(url: string) {
  return url.replace(/\/+$/, "");
}

function parseSnapshotAllowStalePublic() {
  const raw = process.env.SEARCH_SNAPSHOT_ALLOW_STALE_PUBLIC;
  if (!raw) return SNAPSHOT_ALLOW_STALE_PUBLIC_DEFAULT;
  const normalized = raw.trim().toLowerCase();
  if (["0", "false", "off", "no"].includes(normalized)) return false;
  if (["1", "true", "on", "yes"].includes(normalized)) return true;
  return SNAPSHOT_ALLOW_STALE_PUBLIC_DEFAULT;
}

function getSnapshotOrigin(request: Request) {
  const configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configuredOrigin) return normalizeBaseUrl(configuredOrigin);

  try {
    const url = new URL(request.url);
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      return url.origin;
    }
  } catch {
    // Ignore malformed request URL and fall through to header-derived origin.
  }

  const forwardedHost = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (forwardedHost) {
    const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
    return `${forwardedProto}://${forwardedHost}`;
  }

  return "http://localhost";
}

function getSnapshotHttpBaseUrl(origin: string) {
  const configured = process.env.SEARCH_SNAPSHOT_HTTP_BASE_URL?.trim();
  if (configured) return normalizeBaseUrl(configured);
  if (process.env.NODE_ENV === "test") return null;
  return `${normalizeBaseUrl(origin)}/precompute`;
}

async function tryFetchSnapshotText(origin: string, version: string, fileName: string) {
  const baseUrl = getSnapshotHttpBaseUrl(origin);
  if (!baseUrl) return null;
  const versionSegment = encodeURIComponent(version);
  const fileSegment = encodeURIComponent(fileName);
  const url = `${baseUrl}/${versionSegment}/${fileSegment}`;
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function loadSnapshotManifest(version: string, origin: string) {
  if (
    snapshotManifestCache &&
    snapshotManifestCache.version === version &&
    snapshotManifestCache.expiresAtMs > Date.now()
  ) {
    return snapshotManifestCache.value;
  }

  try {
    const path = await import("node:path");
    const summaryPath = path.join(process.cwd(), "data", "precompute", version, "_run-summary.json");
    const raw = (await tryReadFile(summaryPath)) ?? (await tryFetchSnapshotText(origin, version, "_run-summary.json"));
    if (!raw) {
      snapshotManifestCache = {
        version,
        expiresAtMs: Date.now() + SNAPSHOT_MANIFEST_CACHE_TTL_MS,
        value: null,
      };
      return null;
    }
    const parsed = JSON.parse(raw) as {
      finished_at_utc?: string;
      results?: Array<{ city?: string; slug?: string; success?: boolean }>;
    };
    const results = Array.isArray(parsed.results) ? parsed.results : [];
    const entries: SnapshotManifestEntry[] = results
      .filter((entry) => entry.success && typeof entry.city === "string" && typeof entry.slug === "string")
      .map((entry) => ({
        city: entry.city as string,
        slug: entry.slug as string,
      }));
    const manifestValue = entries.length > 0
      ? { finishedAtUtc: parsed.finished_at_utc ?? null, entries }
      : null;
    snapshotManifestCache = {
      version,
      expiresAtMs: Date.now() + SNAPSHOT_MANIFEST_CACHE_TTL_MS,
      value: manifestValue,
    };
    return manifestValue;
  } catch {
    snapshotManifestCache = {
      version,
      expiresAtMs: Date.now() + SNAPSHOT_MANIFEST_CACHE_TTL_MS,
      value: null,
    };
    return null;
  }
}

function buildSnapshotRestaurant(row: Record<string, string>, index: number, fallbackCity: string) {
  const mapsUrl = row["Google Maps URL"]?.trim() || null;
  const googlePlaceId = parsePlaceIdFromMapsUrl(mapsUrl);
  const yelpReviews = parseNumber(row["Yelp Reviews"]);
  const yelpRating = parseNumber(row["Yelp Rating"]);
  const googleReviews = parseNumber(row["Google Reviews"]);
  const googleRating = parseNumber(row["Google Rating"]);
  const score = parseNumber(row["Score"]);
  const city = row["City"]?.trim() || fallbackCity;
  const cuisine = row.Cuisine?.trim() || "";
  const categories = cuisine.length > 0 ? cuisine.split(",").map((item) => item.trim()).filter(Boolean) : [];

  return {
    id: `snapshot-${toCitySlug(city)}-${index + 1}`,
    name: row.Restaurant?.trim() || "Unknown",
    city,
    yelp: {
      rating: yelpRating ?? 0,
      review_count: yelpReviews ?? 0,
      price: (row.Price?.trim() as Restaurant["yelp"]["price"]) || null,
      categories,
      lat: 0,
      lng: 0,
      address: null,
      postal_code: null,
    },
    google: {
      rating: googleRating,
      review_count: googleReviews,
      place_id: googlePlaceId,
      maps_url: mapsUrl,
    },
    michelin: { award: null, green_star: false, matched: false },
    combined_score: score,
  } satisfies Restaurant;
}

async function tryLoadCitySnapshot(city: string, origin: string) {
  if (getServerAppProfile() !== "public") return null;
  if (!parseSnapshotEnabled()) return null;

  const version = process.env.SEARCH_SNAPSHOT_VERSION || SNAPSHOT_VERSION_DEFAULT;
  const manifest = await loadSnapshotManifest(version, origin);
  if (!manifest) return null;

  const citySlug = toCitySlug(city);
  const exactManifestEntry =
    manifest.entries.find((entry) => toCitySlug(entry.city) === citySlug) ??
    manifest.entries.find((entry) => entry.slug === citySlug);
  let manifestEntry = exactManifestEntry;
  if (!manifestEntry) {
    const prefixedEntries = manifest.entries.filter((entry) => entry.slug.startsWith(`${citySlug}-`));
    if (prefixedEntries.length === 1) {
      manifestEntry = prefixedEntries[0];
    } else {
      return null;
    }
  }

  const path = await import("node:path");
  const csvPath = path.join(process.cwd(), "data", "precompute", version, `${manifestEntry.slug}.csv`);
  const rawCsv = (await tryReadFile(csvPath)) ?? (await tryFetchSnapshotText(origin, version, `${manifestEntry.slug}.csv`));
  if (!rawCsv) return null;

  const lines = rawCsv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) return null;

  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i += 1) {
      row[headers[i]] = values[i] ?? "";
    }
    return row;
  });

  const restaurants = rows.map((row, index) => buildSnapshotRestaurant(row, index, city));
  if (restaurants.length === 0) return null;

  const generatedAtUtc =
    rows[0]?.["Snapshot UTC"]?.trim() ||
    manifest.finishedAtUtc ||
    null;
  let ageMinutes: number | null = null;
  if (generatedAtUtc) {
    const generatedAtMs = Date.parse(generatedAtUtc);
    if (!Number.isFinite(generatedAtMs)) return null;
    ageMinutes = Math.max(0, Math.floor((Date.now() - generatedAtMs) / 60000));
  }
  const maxAgeMinutes = parseNonNegativeIntegerEnv(
    process.env.SEARCH_SNAPSHOT_MAX_AGE_MINUTES,
    SNAPSHOT_MAX_AGE_MINUTES_DEFAULT,
  );
  if (ageMinutes !== null && ageMinutes > maxAgeMinutes && !parseSnapshotAllowStalePublic()) return null;
  const googleOnly = parseBooleanString(rows[0]?.["Google Only"]);

  return {
    restaurants: restaurants.slice(0, MERGED_RESULT_LIMIT),
    ageMinutes,
    googleOnly,
  };
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
  policy: SearchProfilePolicy,
) {
  if (prominentRows.length === 0) {
    return {
      attempted: 0,
      matched: 0,
      skipped_budget: 0,
      skipped_lookup_cap: 0,
      skipped_time_budget: 0,
      skipped_rate_limit_stop: 0,
      skipped_no_api_key: 0,
    } satisfies YelpBackfillMetrics;
  }

  let yelpApiKey: string;
  try {
    yelpApiKey = getServerEnv().YELP_API_KEY;
  } catch {
    return {
      attempted: 0,
      matched: 0,
      skipped_budget: prominentRows.length,
      skipped_lookup_cap: 0,
      skipped_time_budget: 0,
      skipped_rate_limit_stop: 0,
      skipped_no_api_key: prominentRows.length,
    } satisfies YelpBackfillMetrics;
  }

  const lookupLimit = policy.yelpProminentLookupLimit;
  const backfillDelayMs = policy.yelpProminentBackfillDelayMs;
  const rateLimitRetryDelayMs = policy.yelpProminentRateLimitRetryDelayMs;
  const maxConsecutive429 = policy.yelpProminentMaxConsecutive429;
  const backfillBudgetMs = policy.yelpProminentBackfillBudgetMs;
  const backfillStartedAtMs = Date.now();
  const targetRows = prominentRows.slice(0, Math.min(lookupLimit, prominentRows.length));
  const skippedLookupCap = Math.max(0, prominentRows.length - targetRows.length);
  if (targetRows.length === 0) {
    return {
      attempted: 0,
      matched: 0,
      skipped_budget: prominentRows.length,
      skipped_lookup_cap: prominentRows.length,
      skipped_time_budget: 0,
      skipped_rate_limit_stop: 0,
      skipped_no_api_key: 0,
    } satisfies YelpBackfillMetrics;
  }
  const isBudgetExceeded = () => Date.now() - backfillStartedAtMs >= backfillBudgetMs;
  const logBudgetExhausted = (remaining: number) => {
    devLog("[prominent-yelp] budget exhausted, stopping backfill", {
      city,
      attempted: attemptedCount,
      remaining,
      budget_ms: backfillBudgetMs,
    });
  };

  let backfilledCount = 0;
  let attemptedCount = 0;
  let rateLimited = false;
  let consecutive429Count = 0;
  let budgetExceeded = false;
  let stoppedByRateLimit = false;

  for (let i = 0; i < targetRows.length; i += 1) {
    if (isBudgetExceeded()) {
      logBudgetExhausted(targetRows.length - i);
      budgetExceeded = true;
      break;
    }
    if (i > 0 && process.env.NODE_ENV !== "test" && backfillDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, backfillDelayMs));
      if (isBudgetExceeded()) {
        logBudgetExhausted(targetRows.length - i);
        budgetExceeded = true;
        break;
      }
    }
    const restaurant = targetRows[i];
    let yelpData: Restaurant["yelp"] | null = null;
    let stillRateLimited = false;
    attemptedCount += 1;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      yelpData = await findYelpDataForProminentRestaurant(city, restaurant, yelpApiKey);
      if (yelpData !== (YELP_RATE_LIMITED_SENTINEL as unknown)) break;
      stillRateLimited = true;

      // Deployed traffic can spike into transient 429s. Retry once with cooldown
      // before giving up and stopping backfill for this request.
      if (attempt === 0 && process.env.NODE_ENV !== "test" && rateLimitRetryDelayMs > 0) {
        if (isBudgetExceeded()) {
          logBudgetExhausted(targetRows.length - i);
          budgetExceeded = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, rateLimitRetryDelayMs));
        if (isBudgetExceeded()) {
          logBudgetExhausted(targetRows.length - i);
          budgetExceeded = true;
          break;
        }
      }
    }
    if (budgetExceeded) break;

    if (stillRateLimited && yelpData === (YELP_RATE_LIMITED_SENTINEL as unknown)) {
      consecutive429Count += 1;
      rateLimited = true;
      if (!isLocal && process.env.NODE_ENV !== "test" && rateLimitRetryDelayMs > 0) {
        // Exponential-style cooldown between rate-limited rows to recover capacity.
        const multiplier = Math.min(4, consecutive429Count);
        if (isBudgetExceeded()) {
          logBudgetExhausted(targetRows.length - i);
          budgetExceeded = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, rateLimitRetryDelayMs * multiplier));
        if (isBudgetExceeded()) {
          logBudgetExhausted(targetRows.length - i);
          budgetExceeded = true;
          break;
        }
      }
      if (consecutive429Count >= maxConsecutive429) {
        stoppedByRateLimit = true;
        devLog("[prominent-yelp] rate-limited, stopping backfill", {
          city,
          attempted: attemptedCount,
          remaining: targetRows.length - (i + 1),
          consecutive_429: consecutive429Count,
        });
        break;
      }
      continue;
    }

    consecutive429Count = 0;
    if (!yelpData) continue;
    restaurant.yelp = yelpData;
    backfilledCount += 1;
  }

  devLog("[prominent-yelp] done", {
    city,
    attempted: attemptedCount,
    matched: backfilledCount,
    skipped: prominentRows.length - targetRows.length,
    rate_limited: rateLimited,
  });

  const unattemptedTargetRows = Math.max(0, targetRows.length - attemptedCount);
  const skippedTimeBudget = budgetExceeded ? unattemptedTargetRows : 0;
  const skippedRateLimitStop = stoppedByRateLimit ? unattemptedTargetRows : 0;
  const skippedBudget = skippedLookupCap + skippedTimeBudget + skippedRateLimitStop;

  return {
    attempted: attemptedCount,
    matched: backfilledCount,
    skipped_budget: skippedBudget,
    skipped_lookup_cap: skippedLookupCap,
    skipped_time_budget: skippedTimeBudget,
    skipped_rate_limit_stop: skippedRateLimitStop,
    skipped_no_api_key: 0,
  } satisfies YelpBackfillMetrics;
}

function countWarningCodes(warnings: SearchWarning[]) {
  const counts: Record<string, number> = {};
  for (const warning of warnings) {
    counts[warning.code] = (counts[warning.code] ?? 0) + 1;
  }
  return counts;
}

function logSearchDiagnostics(diagnostics: SearchDiagnostics) {
  const enableProdDiagnostics = process.env.SEARCH_DIAGNOSTICS_ENABLED === "1";
  if (process.env.NODE_ENV !== "development" && !enableProdDiagnostics) return;
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

function applyProminentGoogleMatches(yelpRows: Restaurant[], prominentRows: Restaurant[]) {
  const usedPlaceIds = new Set<string>();
  let matchedCount = 0;

  for (const yelpRow of yelpRows) {
    if (hasGoogleData(yelpRow.google)) {
      if (yelpRow.google.place_id) usedPlaceIds.add(yelpRow.google.place_id);
      continue;
    }

    let bestMatch: Restaurant | null = null;
    let bestScore = 0;

    for (const prominentRow of prominentRows) {
      if (!hasGoogleData(prominentRow.google)) continue;
      if (prominentRow.google.place_id && usedPlaceIds.has(prominentRow.google.place_id)) continue;

      const nameScore = getNameSimilarity(yelpRow.name, prominentRow.name);
      if (nameScore < 0.45) continue;

      const addressScore = getAddressSimilarity(
        yelpRow.yelp.address ?? null,
        yelpRow.yelp.postal_code ?? null,
        prominentRow.yelp.address ?? null,
        prominentRow.yelp.postal_code ?? null,
      );

      let distanceScore = 0;
      if (hasValidCoordinates(yelpRow) && hasValidCoordinates(prominentRow)) {
        const distanceMeters = getDistanceMeters(
          { lat: yelpRow.yelp.lat, lng: yelpRow.yelp.lng },
          { lat: prominentRow.yelp.lat, lng: prominentRow.yelp.lng },
        );
        if (distanceMeters > MERGED_DEDUPE_DISTANCE_METERS && addressScore < 0.8) continue;
        if (distanceMeters <= MERGED_DEDUPE_DISTANCE_METERS) {
          distanceScore = 1 - distanceMeters / MERGED_DEDUPE_DISTANCE_METERS;
        }
      }

      const hasStrongSignal =
        nameScore >= 0.75 ||
        (nameScore >= 0.55 && addressScore >= 0.45) ||
        (nameScore >= 0.55 && distanceScore >= 0.35) ||
        addressScore >= 0.9;
      if (!hasStrongSignal) continue;

      const score = nameScore * 0.65 + addressScore * 0.2 + distanceScore * 0.15;
      if (score <= bestScore) continue;
      bestScore = score;
      bestMatch = prominentRow;
    }

    if (!bestMatch) continue;
    yelpRow.google = bestMatch.google;
    if (bestMatch.google.place_id) usedPlaceIds.add(bestMatch.google.place_id);
    matchedCount += 1;
  }

  devLog("[prominent-google-prefill] done", {
    yelp_rows: yelpRows.length,
    prominent_rows: prominentRows.length,
    matched: matchedCount,
  });

  return matchedCount;
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
  appProfile: AppProfile,
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

  const response: SearchResponseSuccess = {
    city,
    restaurants: toProfileRestaurants(scored),
    warnings: fallback.warnings,
    google_only: true,
  };
  const cacheWriteDecision = shouldWriteDynamicCityCache(response);
  const cacheTtlMinutes = cacheWriteDecision.write
    ? maybeSetDynamicCityCache(city, appProfile, response) ?? null
    : null;
  const cacheDiagnostics = getCacheDiagnostics(cacheWriteDecision.write, cacheWriteDecision.reason, cacheTtlMinutes);

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
    snapshot_served: false,
    snapshot_age_minutes: null,
    google_prefill_matches: 0,
    yelp_backfill_attempted: 0,
    yelp_backfill_matched: 0,
    yelp_backfill_skipped_budget: 0,
    yelp_backfill_skipped_lookup_cap: 0,
    yelp_backfill_skipped_time_budget: 0,
    yelp_backfill_skipped_rate_limit_stop: 0,
    yelp_backfill_skipped_no_api_key: 0,
    request_budget_mode: warningCodes.length > 0 ? "degraded" : "normal",
    warning_codes: warningCodes,
    ...cacheDiagnostics,
  });

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
  const appProfile = getServerAppProfile();
  const origin = getSnapshotOrigin(request);

  const snapshot = await tryLoadCitySnapshot(city, origin);
  if (snapshot) {
    logSearchDiagnostics({
      mode: "snapshot",
      city,
      total_ms: Date.now() - requestStartedAtMs,
      yelp_status: "snapshot",
      yelp_ms: null,
      google_ms: null,
      google_rows_attempted: 0,
      google_rows_response_ok: 0,
      google_rows_accepted: snapshot.restaurants.filter((restaurant) => hasGoogleData(restaurant.google)).length,
      google_enrichment_failures: {},
      google_match_rate: null,
      michelin_match_rate: null,
      google_prominent_fetched: 0,
      google_prominent_added: 0,
      google_prominent_deduped: 0,
      google_prominent_ms: null,
      snapshot_served: true,
      snapshot_age_minutes: snapshot.ageMinutes,
      google_prefill_matches: 0,
      yelp_backfill_attempted: 0,
      yelp_backfill_matched: 0,
      yelp_backfill_skipped_budget: 0,
      yelp_backfill_skipped_lookup_cap: 0,
      yelp_backfill_skipped_time_budget: 0,
      yelp_backfill_skipped_rate_limit_stop: 0,
      yelp_backfill_skipped_no_api_key: 0,
      cache_hit: false,
      cache_write: false,
      cache_write_skipped_reason: null,
      cache_ttl_minutes: null,
      request_budget_mode: "normal",
      warning_codes: [],
    });

    const response: SearchResponseSuccess = {
      city,
      restaurants: toProfileRestaurants(snapshot.restaurants),
      warnings: [],
      google_only: snapshot.googleOnly ? true : undefined,
    };
    return NextResponse.json(response);
  }

  const cachedResponse = tryGetDynamicCityCache(city, appProfile);
  if (cachedResponse) {
    logSearchDiagnostics({
      mode: "cache",
      city,
      total_ms: Date.now() - requestStartedAtMs,
      yelp_status: "cache_hit",
      yelp_ms: null,
      google_ms: null,
      google_rows_attempted: 0,
      google_rows_response_ok: 0,
      google_rows_accepted: cachedResponse.restaurants.filter((restaurant) => hasGoogleData(restaurant.google)).length,
      google_enrichment_failures: {},
      google_match_rate: null,
      michelin_match_rate: null,
      google_prominent_fetched: 0,
      google_prominent_added: 0,
      google_prominent_deduped: 0,
      google_prominent_ms: null,
      snapshot_served: false,
      snapshot_age_minutes: null,
      google_prefill_matches: 0,
      yelp_backfill_attempted: 0,
      yelp_backfill_matched: 0,
      yelp_backfill_skipped_budget: 0,
      yelp_backfill_skipped_lookup_cap: 0,
      yelp_backfill_skipped_time_budget: 0,
      yelp_backfill_skipped_rate_limit_stop: 0,
      yelp_backfill_skipped_no_api_key: 0,
      cache_hit: true,
      cache_write: false,
      cache_write_skipped_reason: null,
      cache_ttl_minutes: null,
      request_budget_mode: "normal",
      warning_codes: cachedResponse.warnings.map((warning) => warning.code),
    });
    return NextResponse.json(cachedResponse);
  }

  const prominentPromise = fetchGoogleProminentRows(city, {
    resultLimit: GOOGLE_PROMINENT_MAX_RESULTS,
    idPrefix: "google-prominent",
  })
    .then((result) => ({ result, finishedAtMs: Date.now() }))
    .catch(() => ({ result: { restaurants: [], warnings: [] }, finishedAtMs: Date.now() }));
  const prominentStartedAtMs = Date.now();

  const isLocal = isLocalOrigin(origin);
  const profilePolicy = buildSearchProfilePolicy(isLocal, appProfile);
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
            appProfile,
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
          appProfile,
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
        snapshot_served: false,
        snapshot_age_minutes: null,
        google_prefill_matches: 0,
        yelp_backfill_attempted: 0,
        yelp_backfill_matched: 0,
        yelp_backfill_skipped_budget: 0,
        yelp_backfill_skipped_lookup_cap: 0,
        yelp_backfill_skipped_time_budget: 0,
        yelp_backfill_skipped_rate_limit_stop: 0,
        yelp_backfill_skipped_no_api_key: 0,
        cache_hit: false,
        cache_write: false,
        cache_write_skipped_reason: null,
        cache_ttl_minutes: null,
        request_budget_mode: "degraded",
        warning_codes: [],
      });
      return NextResponse.json(failureEnvelope(city, code, message), { status });
    }

    const prominentOutcome = await prominentPromise;
    const prefetchedProminent = prominentOutcome.result;
    const prefetchedProminentMs = prominentOutcome.finishedAtMs - prominentStartedAtMs;
    return googleOnlyFallback(
      city,
      appProfile,
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
      appProfile,
      { requestStartedAtMs, yelpStatus: "zero_results", yelpMs },
      prefetchedProminent,
      prefetchedProminentMs,
    );
  }

  const prominentOutcome = await prominentPromise;
  const prominent = prominentOutcome.result;
  const prominentMs = prominentOutcome.finishedAtMs - prominentStartedAtMs;
  const googlePrefillMatches = applyProminentGoogleMatches(restaurants, prominent.restaurants);

  const maxGoogleEnrichments = profilePolicy.maxGoogleEnrichments;
  const targetRestaurants = restaurants
    .filter((restaurant) => !hasGoogleData(restaurant.google))
    .slice(0, maxGoogleEnrichments);
  const targetCount = targetRestaurants.length;

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

      const restaurant = targetRestaurants[index];
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
  const prominentUniqueRows = dedupeProminentAgainstYelp(restaurants, prominent.restaurants);
  const yelpBackfillMetrics = await backfillProminentRowsWithYelpData(
    city,
    prominentUniqueRows,
    isLocal,
    profilePolicy,
  );
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
  const googleAccepted = targetRestaurants.filter((restaurant) => hasGoogleData(restaurant.google)).length;
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
  const hasBackfillDegradation =
    yelpBackfillMetrics.skipped_time_budget > 0 ||
    yelpBackfillMetrics.skipped_rate_limit_stop > 0 ||
    yelpBackfillMetrics.skipped_no_api_key > 0;
  const requestBudgetMode: "normal" | "degraded" =
    warnings.length > 0 || hasBackfillDegradation ? "degraded" : "normal";

  const response: SearchResponseSuccess = {
    city,
    restaurants: toProfileRestaurants(mergedRestaurants),
    warnings,
  };
  const cacheWriteDecision = shouldWriteDynamicCityCache(response, requestBudgetMode);
  const cacheTtlMinutes = cacheWriteDecision.write
    ? maybeSetDynamicCityCache(city, appProfile, response) ?? null
    : null;
  const cacheDiagnostics = getCacheDiagnostics(cacheWriteDecision.write, cacheWriteDecision.reason, cacheTtlMinutes);

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
    snapshot_served: false,
    snapshot_age_minutes: null,
    google_prefill_matches: googlePrefillMatches,
    yelp_backfill_attempted: yelpBackfillMetrics.attempted,
    yelp_backfill_matched: yelpBackfillMetrics.matched,
    yelp_backfill_skipped_budget: yelpBackfillMetrics.skipped_budget,
    yelp_backfill_skipped_lookup_cap: yelpBackfillMetrics.skipped_lookup_cap,
    yelp_backfill_skipped_time_budget: yelpBackfillMetrics.skipped_time_budget,
    yelp_backfill_skipped_rate_limit_stop: yelpBackfillMetrics.skipped_rate_limit_stop,
    yelp_backfill_skipped_no_api_key: yelpBackfillMetrics.skipped_no_api_key,
    request_budget_mode: requestBudgetMode,
    warning_codes: warnings.map((warning) => warning.code),
    ...cacheDiagnostics,
  });

  return NextResponse.json(response);
}
