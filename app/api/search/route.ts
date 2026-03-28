import { NextResponse } from "next/server";
import type { Restaurant, SearchResponseFailure, SearchResponseSuccess, SearchWarning, WarningCode } from "@/lib/types";
import { rejectGoogleEnrichment } from "@/lib/matching";
import { matchMichelinForRestaurant } from "@/lib/michelin";
import { computeCombinedScores } from "@/lib/scoring";

const MAX_GOOGLE_ENRICHMENTS = 20;
const GOOGLE_CONCURRENCY = 5;
const GOOGLE_REQUEST_TIMEOUT_MS = 3000;
const ENRICHMENT_BUDGET_MS = 6000;

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
    return NextResponse.json(
      failureEnvelope(city, "YELP_UPSTREAM_ERROR", "Failed to fetch Yelp restaurants."),
      { status: 502 },
    );
  }

  if (!yelpResponse.ok) {
    const yelpPayload = (await yelpResponse.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    const code = yelpPayload?.error?.code ?? "YELP_UPSTREAM_ERROR";
    const message = yelpPayload?.error?.message ?? "Failed to fetch Yelp restaurants.";
    const status =
      code === "INVALID_INPUT"
        ? 400
        : code === "CONFIG_ERROR"
          ? 500
          : code === "YELP_RATE_LIMITED"
            ? 429
          : code === "YELP_TIMEOUT"
            ? 504
            : 502;
    return NextResponse.json(failureEnvelope(city, code, message), { status });
  }

  const yelpPayload = (await yelpResponse.json()) as { city: string; restaurants: YelpSeed[] };
  const restaurants = yelpPayload.restaurants.map((seed) => buildRestaurantFromSeed(seed));
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

  for (const restaurant of restaurants) {
    restaurant.michelin = matchMichelinForRestaurant({
      city: restaurant.city,
      lat: restaurant.yelp.lat,
      lng: restaurant.yelp.lng,
    });
  }

  const scoredRestaurants = computeCombinedScores(restaurants);

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
