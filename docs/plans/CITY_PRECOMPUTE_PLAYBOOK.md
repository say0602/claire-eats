# City Precompute Playbook (30-City Pilot)

## Goal

Run an internal precompute experiment for 30 cities, save private CSV snapshots, and evaluate whether a 200-city cached catalog is worth shipping.

**Internal experimentation only** — not for public redistribution until API terms and legal constraints are confirmed.

## Scope and Principles

- Reuse the **existing search logic** via a script that calls the same code path as `/api/search`.
- Produce one CSV snapshot per city with a clear timestamp.
- Capture quality, reliability, and runtime metrics before scaling.

## Pilot City Set (30)

### Core cities (requested)

| # | City | Expected mode |
|---|------|---------------|
| 1 | San Francisco, CA | Yelp primary |
| 2 | Los Angeles, CA | Yelp primary |
| 3 | Seattle, WA | Yelp primary |
| 4 | San Diego, CA | Yelp primary |
| 5 | Bozeman, MT | Yelp primary (small set expected) |
| 6 | Livingston, MT | Yelp primary (very small set expected) |
| 7 | New York, NY | Yelp primary |
| 8 | Chicago, IL | Yelp primary |
| 9 | New Orleans, LA | Yelp primary |

### Texas cluster

| # | City | Expected mode |
|---|------|---------------|
| 10 | Austin, TX | Yelp primary |
| 11 | Dallas, TX | Yelp primary |
| 12 | Houston, TX | Yelp primary |
| 13 | San Antonio, TX | Yelp primary |
| 14 | Fort Worth, TX | Yelp primary |

### Additional US demand cities

| # | City | Expected mode |
|---|------|---------------|
| 15 | Miami, FL | Yelp primary |
| 16 | Boston, MA | Yelp primary |
| 17 | Las Vegas, NV | Yelp primary |
| 18 | Washington, DC | Yelp primary |
| 19 | Atlanta, GA | Yelp primary |
| 20 | Nashville, TN | Yelp primary |

### Global validation cities

| # | City | Expected mode |
|---|------|---------------|
| 21 | London, UK | Yelp primary (limited coverage possible) |
| 22 | Paris, France | Yelp primary (limited coverage possible) |
| 23 | Tokyo, Japan | Google-only fallback likely |
| 24 | Seoul, South Korea | Google-only fallback likely |
| 25 | Singapore | Google-only fallback likely |
| 26 | Bangkok, Thailand | Google-only fallback likely |
| 27 | Barcelona, Spain | Yelp primary (limited coverage possible) |
| 28 | Rome, Italy | Yelp primary (limited coverage possible) |
| 29 | Mexico City, Mexico | Google-only fallback likely |
| 30 | Toronto, Canada | Yelp primary |

**Note:** International cities with no Yelp coverage will trigger Google-only fallback mode. This is expected and useful to validate fallback quality at scale.

## Run Configuration

The precompute script will run locally (calling `localhost`), which means the route uses **local-mode constants** from `app/api/search/route.ts`:

| Setting | Local value | Notes |
|---------|-------------|-------|
| Yelp base list | 50 rows (by review count) | Unchanged |
| Google enrichment cap | 50 rows | `MAX_GOOGLE_ENRICHMENTS` (local) |
| Google prominent fetch | up to 60 (3 pages x 20) | Same local/deployed |
| Yelp prominent backfill | up to 30 rows | `YELP_PROMINENT_LOOKUP_LIMIT_LOCAL` |
| Backfill delay | 120ms between requests | `YELP_PROMINENT_BACKFILL_DELAY_MS` |
| Merged result cap | 80 | `MERGED_RESULT_LIMIT` |

### Request volume per city (local mode)

| Provider | Requests | Calculation |
|----------|----------|-------------|
| Yelp (base list) | 1 | Single fetch |
| Google (enrichment) | up to 50 | One per Yelp row |
| Google (prominent) | up to 3 | Paginated fetch |
| Yelp (backfill) | up to 30 | One per prominent addition |
| **Total** | **up to 84** | Worst case |

### Totals for 30 cities

| Provider | Max requests | Notes |
|----------|-------------|-------|
| Yelp | ~930 | 30 base + up to 900 backfill |
| Google | ~1,590 | up to 1,500 enrichment + 90 prominent |

### Runtime estimate

- Per city (local with backfill): typically 15–45s depending on Yelp coverage and backfill hits.
- 30 cities sequential with 5s inter-city delay: **~15–30 minutes total**.
- Google-only fallback cities (no Yelp backfill) are faster: ~6–10s each.

## CSV Snapshot Contract

Reuse the existing `buildRestaurantsCsv` column layout from `components/RestaurantTable.tsx` with two additional metadata columns appended:

| Column | Source | Notes |
|--------|--------|-------|
| Rank | Computed | Position in default sort (Total Reviews desc) |
| Restaurant | Restaurant name | |
| Score | `combined_score` | 1 decimal, or empty if null |
| Total Reviews | Yelp + Google reviews | |
| Yelp Rating | `yelp.rating` | Empty when Yelp missing |
| Yelp Reviews | `yelp.review_count` | Empty when Yelp missing |
| Google Rating | `google.rating` | Empty when null |
| Google Reviews | `google.review_count` | Empty when null |
| Price | `yelp.price` | Empty when missing |
| Cuisine | `yelp.categories` joined | |
| City | Search city | |
| Google Maps URL | `google.maps_url` | Empty when null |
| Snapshot UTC | ISO 8601 timestamp | When this city was fetched |
| Google Only | `true` / `false` | Whether response was Google-only fallback |

### Notes

- Use empty string (not `-`) for missing values in precompute CSVs for cleaner downstream parsing. The UI `Download CSV` button keeps `-` for user readability; precompute CSVs are for machine consumption.
- Score is displayed value (1 decimal) for consistency.
- Sort order: Total Reviews descending (matches current UI default).

## File Layout

```
data/precompute/pilot-v1/
├── san-francisco-ca.csv
├── los-angeles-ca.csv
├── bozeman-mt.csv
├── ...
└── _run-summary.json
```

City file name: `<city-slug>.csv` (lowercase, hyphens, no timestamp in filename — the timestamp lives inside each row and in the run summary).

## Run Summary Schema (`_run-summary.json`)

```json
{
  "version": "pilot-v1",
  "started_at_utc": "2026-03-24T22:00:00Z",
  "finished_at_utc": "2026-03-24T22:28:00Z",
  "total_cities": 30,
  "results": [
    {
      "city": "San Francisco, CA",
      "slug": "san-francisco-ca",
      "success": true,
      "google_only": false,
      "duration_ms": 18200,
      "result_count": 67,
      "yelp_rows": 50,
      "google_prominent_added": 17,
      "pct_missing_google_rating": 12.5,
      "pct_missing_yelp_rating": 25.4,
      "warnings": ["PARTIAL_ENRICHMENT"],
      "error": null
    }
  ],
  "aggregate": {
    "success_rate": 0.97,
    "p50_duration_ms": 16000,
    "p95_duration_ms": 38000,
    "google_only_count": 5,
    "hard_error_count": 0,
    "avg_result_count": 58.3,
    "avg_pct_missing_google_rating": 15.2,
    "avg_pct_missing_yelp_rating": 18.7
  }
}
```

## Batch Execution Order

Run sequentially in 3 batches with a review gate between each.

### Batch A — US major + Texas (14 cities)

San Francisco, Los Angeles, Seattle, San Diego, New York, Chicago, New Orleans, Austin, Dallas, Houston, San Antonio, Fort Worth, Miami, Nashville

**Review gate:** Check success rate, runtime, warning profile. If > 2 failures or a hard error, stop and investigate before proceeding.

### Batch B — US secondary + small towns (6 cities)

Bozeman, Livingston, Boston, Las Vegas, Washington, Atlanta

**Review gate:** Bozeman and Livingston test small-city behavior. Expect fewer results — not a failure if result count is low. Confirm no hard errors.

### Batch C — International (10 cities)

London, Paris, Tokyo, Seoul, Singapore, Bangkok, Barcelona, Rome, Mexico City, Toronto

**Review gate:** Expect 5+ cities to trigger Google-only fallback. Confirm fallback CSVs have valid Google data and reasonable result counts.

## Inter-City Cooldown

Wait **5 seconds** between cities within a batch. This reduces risk of cascading Yelp rate-limits (the backfill loop already handles per-request delay, but inter-city spacing adds a buffer).

## Retry Policy

Per-city retries:

- Max retries: **2**
- Backoff: 3s, then 8s (with ~20% jitter)
- Retry on: network errors, 429, upstream 5xx, timeout
- Do **not** retry on: `CONFIG_ERROR`, auth errors, `INVALID_ARGUMENT`

If a city exhausts retries, log the failure in the run summary and continue.

## Stop Thresholds

Stop the current batch and investigate if any of these occur:

| Threshold | Trigger |
|-----------|---------|
| Auth / config error | Any city returns `CONFIG_ERROR` or permission denied |
| Consecutive failures | 3+ cities fail in a row |
| Yelp rate-limit cascade | 2+ cities hit Yelp `429` on base list (not backfill) |
| Empty-result rate | > 30% of US cities return 0 results (unexpected) |

## Go / No-Go Criteria for 200-City Scale

Proceed only if **all** are met:

- Success rate >= 90% (accounting for expected Google-only fallback cities)
- p95 runtime <= 45s (local mode with backfill)
- Hard errors == 0
- Warning profile is stable (no new warning codes)
- Total API cost for 30 cities is acceptable for 7x extrapolation
- Legal/terms review confirms allowed storage and display approach

If not met: tune and rerun the 30-city pilot before scaling.

## Legal and Policy Checklist (Before Any Public Use)

- [ ] Review [Yelp Fusion API Terms](https://www.yelp.com/developers/api_terms) — storage duration, caching, redistribution
- [ ] Review [Google Maps Platform Terms](https://cloud.google.com/maps-platform/terms) — Places data storage/display restrictions
- [ ] Verify attribution requirements for both providers
- [ ] Confirm affiliate-link usage is compatible with data usage terms
- [ ] If unclear on any point, get legal review before public rollout

**Until confirmed, keep all snapshots private/internal.**

## Recommended Execution Steps

1. Build the precompute script (`scripts/precompute-cities.ts`) that:
   - Reads city list from a config array.
   - Calls the same search logic as the route handler.
   - Writes per-city CSV + appends to run summary.
   - Respects retry policy and inter-city cooldown.
2. Run **Batch A** and review the `_run-summary.json`.
3. If healthy, run **Batch B** and **Batch C**.
4. Review aggregate metrics against go/no-go criteria.
5. Decide next step:
   - Scale to 200 cities with scheduled refresh, or
   - Keep as internal cache layer only, or
   - Adjust strategy based on findings.
