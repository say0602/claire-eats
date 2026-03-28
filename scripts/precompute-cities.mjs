import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_VERSION = "pilot-v1";
const OUTPUT_DIR = path.join(process.cwd(), "data", "precompute", OUTPUT_VERSION);
const BASE_URL = process.env.PRECOMPUTE_BASE_URL ?? "http://localhost:3000";
const INTER_CITY_DELAY_MS = 5000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = [3000, 8000];

const BATCHES = [
  {
    name: "batch-a",
    cities: [
      "San Francisco, CA",
      "Los Angeles, CA",
      "Seattle, WA",
      "San Diego, CA",
      "New York, NY",
      "Chicago, IL",
      "New Orleans, LA",
      "Austin, TX",
      "Dallas, TX",
      "Houston, TX",
      "San Antonio, TX",
      "Fort Worth, TX",
      "Miami, FL",
      "Nashville, TN",
    ],
  },
  {
    name: "batch-b",
    cities: [
      "Bozeman, MT",
      "Livingston, MT",
      "Boston, MA",
      "Las Vegas, NV",
      "Washington, DC",
      "Atlanta, GA",
    ],
  },
  {
    name: "batch-c",
    cities: [
      "London, UK",
      "Paris, France",
      "Tokyo, Japan",
      "Seoul, South Korea",
      "Singapore",
      "Bangkok, Thailand",
      "Barcelona, Spain",
      "Rome, Italy",
      "Mexico City, Mexico",
      "Toronto, Canada",
    ],
  },
];

function slugifyCity(city) {
  return city
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(ms) {
  const jitterRatio = 0.2;
  const delta = ms * jitterRatio;
  return Math.max(0, Math.round(ms + (Math.random() * 2 - 1) * delta));
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))];
}

function average(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function escapeCsv(value) {
  const stringValue = value === null || value === undefined ? "" : String(value);
  if (stringValue.includes(",") || stringValue.includes("\"") || stringValue.includes("\n")) {
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  }
  return stringValue;
}

function totalReviews(restaurant) {
  return (restaurant.yelp?.review_count ?? 0) + (restaurant.google?.review_count ?? 0);
}

function buildPilotCsv(restaurants, { snapshotUtc, googleOnly }) {
  const sorted = [...restaurants].sort((a, b) => totalReviews(b) - totalReviews(a));
  const headers = [
    "Rank",
    "Restaurant",
    "Score",
    "Total Reviews",
    "Yelp Rating",
    "Yelp Reviews",
    "Google Rating",
    "Google Reviews",
    "Price",
    "Cuisine",
    "City",
    "Google Maps URL",
    "Snapshot UTC",
    "Google Only",
  ];

  const rows = sorted.map((restaurant, index) => {
    const yelpMissing = googleOnly || (restaurant.yelp?.review_count ?? 0) === 0;
    return [
      index + 1,
      restaurant.name ?? "",
      restaurant.combined_score == null ? "" : Number(restaurant.combined_score).toFixed(1),
      totalReviews(restaurant),
      yelpMissing || restaurant.yelp?.rating == null ? "" : Number(restaurant.yelp.rating).toFixed(1),
      yelpMissing ? "" : (restaurant.yelp?.review_count ?? ""),
      restaurant.google?.rating == null ? "" : Number(restaurant.google.rating).toFixed(1),
      restaurant.google?.review_count ?? "",
      yelpMissing ? "" : (restaurant.yelp?.price ?? ""),
      Array.isArray(restaurant.yelp?.categories) ? restaurant.yelp.categories.join(", ") : "",
      restaurant.city ?? "",
      restaurant.google?.maps_url ?? "",
      snapshotUtc,
      googleOnly ? "true" : "false",
    ];
  });

  return [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
}

function isTransientError(result) {
  const code = result?.error?.code;
  return (
    code === "YELP_RATE_LIMITED" ||
    code === "YELP_TIMEOUT" ||
    code === "GOOGLE_RATE_LIMITED" ||
    code === "GOOGLE_TIMEOUT" ||
    code === "GOOGLE_UPSTREAM_ERROR" ||
    code === "PARTIAL_ENRICHMENT" ||
    code === "NETWORK_ERROR"
  );
}

async function fetchCity(city) {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${BASE_URL}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ city }),
    });

    const payload = await response.json();
    const durationMs = Date.now() - startedAt;

    if (!response.ok || payload?.error) {
      return {
        ok: false,
        durationMs,
        payload,
        error: payload?.error ?? { code: `HTTP_${response.status}`, message: "Unknown error" },
      };
    }

    if (!Array.isArray(payload?.restaurants)) {
      return {
        ok: false,
        durationMs,
        payload,
        error: { code: "INVALID_PAYLOAD", message: "Response does not include restaurants array." },
      };
    }

    return {
      ok: true,
      durationMs,
      payload,
    };
  } catch (error) {
    return {
      ok: false,
      durationMs: Date.now() - startedAt,
      payload: null,
      error: {
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Network error",
      },
    };
  }
}

async function runWithRetry(city) {
  let attempt = 0;
  let lastResult = null;
  while (attempt <= MAX_RETRIES) {
    const result = await fetchCity(city);
    if (result.ok) return { ...result, attempts: attempt + 1 };

    lastResult = result;
    if (!isTransientError(result) || attempt === MAX_RETRIES) {
      return { ...result, attempts: attempt + 1 };
    }

    const delayMs = jitter(RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]);
    console.log(`[retry] ${city} attempt ${attempt + 1} failed (${result.error.code}), waiting ${delayMs}ms`);
    await sleep(delayMs);
    attempt += 1;
  }

  return { ...lastResult, attempts: MAX_RETRIES + 1 };
}

function summarizeCityResult(city, slug, result) {
  if (!result.ok) {
    return {
      city,
      slug,
      success: false,
      google_only: false,
      duration_ms: result.durationMs,
      result_count: 0,
      yelp_rows: 0,
      google_prominent_added: 0,
      pct_missing_google_rating: null,
      pct_missing_yelp_rating: null,
      warnings: [],
      error: result.error,
      attempts: result.attempts,
    };
  }

  const payload = result.payload;
  const restaurants = payload.restaurants;
  const googleOnly = payload.google_only === true;
  const yelpRows = restaurants.filter((row) => (row.yelp?.review_count ?? 0) > 0).length;
  const googleProminentAdded = Math.max(0, restaurants.length - yelpRows);
  const missingGoogleCount = restaurants.filter((row) => row.google?.rating == null).length;
  const missingYelpCount = restaurants.filter((row) => (row.yelp?.review_count ?? 0) === 0).length;

  return {
    city,
    slug,
    success: true,
    google_only: googleOnly,
    duration_ms: result.durationMs,
    result_count: restaurants.length,
    yelp_rows: yelpRows,
    google_prominent_added: googleProminentAdded,
    pct_missing_google_rating:
      restaurants.length === 0 ? null : Math.round((missingGoogleCount / restaurants.length) * 1000) / 10,
    pct_missing_yelp_rating:
      restaurants.length === 0 ? null : Math.round((missingYelpCount / restaurants.length) * 1000) / 10,
    warnings: Array.isArray(payload.warnings) ? payload.warnings.map((warning) => warning.code) : [],
    error: null,
    attempts: result.attempts,
  };
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const startedAtUtc = new Date().toISOString();
  const results = [];

  let cityIndex = 0;
  const totalCities = BATCHES.reduce((sum, batch) => sum + batch.cities.length, 0);

  console.log(`[precompute] base_url=${BASE_URL}`);
  console.log(`[precompute] output_dir=${OUTPUT_DIR}`);
  console.log(`[precompute] total_cities=${totalCities}`);

  for (const batch of BATCHES) {
    console.log(`[precompute] starting ${batch.name} (${batch.cities.length} cities)`);
    for (const city of batch.cities) {
      cityIndex += 1;
      const slug = slugifyCity(city);
      console.log(`[precompute] [${cityIndex}/${totalCities}] city=${city}`);

      const result = await runWithRetry(city);
      const summary = summarizeCityResult(city, slug, result);
      results.push(summary);

      if (result.ok) {
        const snapshotUtc = new Date().toISOString();
        const csv = buildPilotCsv(result.payload.restaurants, {
          snapshotUtc,
          googleOnly: result.payload.google_only === true,
        });
        const csvPath = path.join(OUTPUT_DIR, `${slug}.csv`);
        await writeFile(csvPath, `\uFEFF${csv}`, "utf8");
        console.log(
          `[precompute] success city=${city} rows=${summary.result_count} duration_ms=${summary.duration_ms} attempts=${summary.attempts}`,
        );
      } else {
        console.log(
          `[precompute] failure city=${city} code=${summary.error.code} duration_ms=${summary.duration_ms} attempts=${summary.attempts}`,
        );
      }

      if (cityIndex < totalCities) {
        await sleep(INTER_CITY_DELAY_MS);
      }
    }
  }

  const successRows = results.filter((item) => item.success);
  const durations = results.map((item) => item.duration_ms);
  const hardErrorCount = results.filter(
    (item) => !item.success && item.error && (item.error.code === "CONFIG_ERROR" || item.error.code === "YELP_RATE_LIMITED"),
  ).length;

  const aggregate = {
    success_rate: results.length === 0 ? 0 : Math.round((successRows.length / results.length) * 1000) / 1000,
    p50_duration_ms: percentile(durations, 50),
    p95_duration_ms: percentile(durations, 95),
    google_only_count: results.filter((item) => item.google_only).length,
    hard_error_count: hardErrorCount,
    avg_result_count: average(successRows.map((item) => item.result_count)),
    avg_pct_missing_google_rating: average(
      successRows
        .map((item) => item.pct_missing_google_rating)
        .filter((value) => typeof value === "number"),
    ),
    avg_pct_missing_yelp_rating: average(
      successRows
        .map((item) => item.pct_missing_yelp_rating)
        .filter((value) => typeof value === "number"),
    ),
  };

  const runSummary = {
    version: OUTPUT_VERSION,
    base_url: BASE_URL,
    started_at_utc: startedAtUtc,
    finished_at_utc: new Date().toISOString(),
    total_cities: totalCities,
    results,
    aggregate,
  };

  const summaryPath = path.join(OUTPUT_DIR, "_run-summary.json");
  await writeFile(summaryPath, JSON.stringify(runSummary, null, 2), "utf8");
  console.log(`[precompute] summary written to ${summaryPath}`);
}

main().catch((error) => {
  console.error("[precompute] fatal error", error);
  process.exitCode = 1;
});
