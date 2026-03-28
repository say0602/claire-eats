import { NextResponse } from "next/server";
import { EnvValidationError, getServerEnv } from "@/lib/env";
import { resolveGoogleEnrichment, rejectGoogleEnrichment } from "@/lib/matching";

const GOOGLE_TEXT_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json";
const GOOGLE_TIMEOUT_MS = 2500;
const RETRY_BASE_DELAY_MS = 300;

type GoogleTextSearchResult = {
  name?: string;
  rating?: number;
  user_ratings_total?: number;
  place_id?: string;
  geometry?: {
    location?: {
      lat?: number;
      lng?: number;
    };
  };
};

type GoogleTextSearchResponse = {
  status?: string;
  error_message?: string;
  results?: GoogleTextSearchResult[];
};

type GoogleFallbackCode = "GOOGLE_TIMEOUT" | "GOOGLE_RATE_LIMITED" | "GOOGLE_UPSTREAM_ERROR";

function withTimeout(ms: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFallback(code: GoogleFallbackCode, message: string) {
  return {
    ok: false as const,
    code,
    message,
    google: rejectGoogleEnrichment(),
  };
}

function isRetryableGoogleStatus(status: string | undefined) {
  return status === "OVER_QUERY_LIMIT" || status === "UNKNOWN_ERROR";
}

function mapGoogleStatusToFallbackCode(status: string | undefined): GoogleFallbackCode {
  if (status === "OVER_QUERY_LIMIT") return "GOOGLE_RATE_LIMITED";
  if (status === "UNKNOWN_ERROR") return "GOOGLE_UPSTREAM_ERROR";
  return "GOOGLE_UPSTREAM_ERROR";
}

export async function POST(request: Request) {
  let name = "";
  let city = "";
  let lat: number | null = null;
  let lng: number | null = null;

  try {
    const body = await request.json();
    name = typeof body?.name === "string" ? body.name.trim() : "";
    city = typeof body?.city === "string" ? body.city.trim() : "";
    lat = typeof body?.lat === "number" ? body.lat : null;
    lng = typeof body?.lng === "number" ? body.lng : null;
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Request body must be valid JSON." } },
      { status: 400 },
    );
  }

  if (!name || !city) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Fields `name` and `city` are required." } },
      { status: 400 },
    );
  }

  let apiKey = "";
  try {
    apiKey = getServerEnv().GOOGLE_MAPS_API_KEY;
  } catch (error) {
    if (error instanceof EnvValidationError) {
      return NextResponse.json(
        { error: { code: "CONFIG_ERROR", message: error.message } },
        { status: 500 },
      );
    }
    throw error;
  }

  const query = `${name} ${city}`;
  const url = new URL(GOOGLE_TEXT_SEARCH_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("key", apiKey);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const timeout = withTimeout(GOOGLE_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: timeout.signal,
        cache: "no-store",
      });

      if (response.status === 429 || response.status >= 500) {
        if (attempt === 0) {
          const jitter = Math.floor(Math.random() * 100);
          await sleep(RETRY_BASE_DELAY_MS + jitter);
          continue;
        }

        const code = response.status === 429 ? "GOOGLE_RATE_LIMITED" : "GOOGLE_UPSTREAM_ERROR";
        return NextResponse.json(createFallback(code, `Google request failed with status ${response.status}.`));
      }

      if (!response.ok) {
        return NextResponse.json(
          createFallback("GOOGLE_UPSTREAM_ERROR", `Google request failed with status ${response.status}.`),
        );
      }

      const payload = (await response.json()) as GoogleTextSearchResponse;
      const googleStatus = payload.status;

      if (googleStatus && googleStatus !== "OK" && googleStatus !== "ZERO_RESULTS") {
        if (attempt === 0 && isRetryableGoogleStatus(googleStatus)) {
          const jitter = Math.floor(Math.random() * 100);
          await sleep(RETRY_BASE_DELAY_MS + jitter);
          continue;
        }

        const code = mapGoogleStatusToFallbackCode(googleStatus);
        const message = payload.error_message
          ? `${googleStatus}: ${payload.error_message}`
          : `Google request failed with status ${googleStatus}.`;
        return NextResponse.json(createFallback(code, message));
      }

      const first = payload.results?.[0];

      const enrichment = resolveGoogleEnrichment(
        {
          name,
          lat,
          lng,
        },
        first
          ? {
              name: first.name ?? null,
              lat: first.geometry?.location?.lat ?? null,
              lng: first.geometry?.location?.lng ?? null,
              rating: first.rating ?? null,
              user_ratings_total: first.user_ratings_total ?? null,
              place_id: first.place_id ?? null,
            }
          : null,
      );

      return NextResponse.json({ ok: true, google: enrichment });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        if (attempt === 0) {
          const jitter = Math.floor(Math.random() * 100);
          await sleep(RETRY_BASE_DELAY_MS + jitter);
          continue;
        }
        return NextResponse.json(createFallback("GOOGLE_TIMEOUT", "Google request timed out."));
      }

      if (attempt === 0) {
        const jitter = Math.floor(Math.random() * 100);
        await sleep(RETRY_BASE_DELAY_MS + jitter);
        continue;
      }
      return NextResponse.json(createFallback("GOOGLE_UPSTREAM_ERROR", "Google request failed."));
    } finally {
      timeout.clear();
    }
  }

  return NextResponse.json(createFallback("GOOGLE_UPSTREAM_ERROR", "Google request failed."));
}
