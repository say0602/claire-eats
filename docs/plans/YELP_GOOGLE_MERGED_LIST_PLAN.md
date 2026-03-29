---
status: in_progress
---

# Yelp + Google Merged List Plan

## Goal

Change normal search behavior from "Yelp rows only (50)" to a merged list:

- Start with Yelp top 50 by review count (unchanged).
- Fetch Google prominent restaurants in **parallel** (up to 60 via Places API New pagination).
- After Yelp enrichment completes, deduplicate prominent rows against enriched Yelp rows.
- Append unique Google-only additions.
- Return the merged list capped at `MERGED_RESULT_LIMIT`.

Fallback mode (Google-only for cities without Yelp coverage) remains unchanged.

## Implemented Behavior

- Normal mode now returns a merged list:
  - Yelp rows (up to 50) are retained.
  - Google prominent rows (up to 60 fetched) are deduped and appended.
  - Final output is capped at `MERGED_RESULT_LIMIT = 80`.
- Google-only fallback mode remains active when Yelp returns zero/unsupported results or non-hard-fail errors.
- `fetchGoogleProminentRows` is used for both:
  - normal-mode merged additions (prefetched in parallel), and
  - Google-only fallback mode.
- Deployed environments (Cloudflare): `DEPLOYED_MAX_GOOGLE_ENRICHMENTS = 45` to remain within subrequest budget when prominent prefetch is enabled.
- Deployed live-path tuning for prominent Yelp backfill is implemented:
  - configurable lookup limit, delay, retry delay, and consecutive-429 cutoff
  - sequential backfill with transient-429 handling
- Prominent Google data is reused to prefill Yelp rows before `/api/google` enrichment calls (reduces redundant Google calls in live mode).
- Phase F/J code paths are implemented:
  - public-profile snapshot read path from `data/precompute/<version>/...`
  - snapshot freshness guard (`SEARCH_SNAPSHOT_MAX_AGE_MINUTES`)
  - diagnostics expansion (`snapshot_served`, `snapshot_age_minutes`, `google_prefill_matches`, `yelp_backfill_*`, `request_budget_mode`)
  - snapshot contract safeguards:
    - `google_only` propagated from snapshot metadata
    - invalid snapshot timestamps fail closed to live path
    - snapshot manifest cache is version-aware
    - ambiguous prefix slug matches are rejected (fallback to live)
- Phase G live-path budget controls are implemented:
  - hard backfill time-budget guardrail (`YELP_PROMINENT_BACKFILL_BUDGET_MS`, default 30s)
    - budget checked at loop start, after inter-row delay, before/after retry cooldown, and before/after exponential 429 cooldown
  - public-profile backfill lookup cap (`YELP_PROMINENT_LOOKUP_LIMIT_PUBLIC`) applied on top of deployed limit
  - `request_budget_mode` refined: intentional policy caps (lookup cap) stay `"normal"`; only actual failures (time budget, rate-limit stop, missing API key) mark `"degraded"`
  - granular backfill skip diagnostics: `skipped_lookup_cap`, `skipped_time_budget`, `skipped_rate_limit_stop`, `skipped_no_api_key`
  - all diagnostics modes (`yelp_primary`, `google_fallback`, `snapshot`, `yelp_error`) emit consistent schema for skip fields

## Current Reality Check

What is implemented in code and tested:
- Phases A-E: implemented.
- Phase F (snapshot read path): implemented behind runtime conditions.
- Phase G (live-path budget reduction): implemented — hard time budget, public lookup cap, granular skip diagnostics, refined degraded-mode semantics.
- Phase H (dynamic city cache): implemented as in-memory TTL slice (profile-aware keying, read/write path, bounded pruning, telemetry).
- Phase I (profile policy): implemented via centralized `SearchProfilePolicy`.
- Phase J (diagnostics/safeguards): implemented — all modes emit consistent schema; reasoned skip counters added.

What is still operationally pending:
- Snapshot artifacts deployment plumbing is now implemented:
  - build-time sync copies `data/precompute` into `public/precompute` via `scripts/sync-precompute-to-public.mjs` (`prebuild` hook).
  - `/api/search` snapshot loader now falls back to HTTP snapshot reads when runtime filesystem reads are unavailable.
  - optional `SEARCH_SNAPSHOT_HTTP_BASE_URL` supports externally hosted snapshots (R2/CDN/static host) with the same `<base>/<version>/...` layout.

## Next Iteration Plan (Free Plan Optimization)

### Why this is needed

On Cloudflare free tier, merged search quality can diverge between local and deployed behavior when a single request performs too many upstream calls (Yelp seed + Google enrichments + Google prominent paging + Yelp backfill). In practice, this can lead to many Google-added rows with empty Yelp fields in production even when local looks strong.

### Goals

1. Improve Cloudflare free-tier reliability without upgrading plan.
2. Reduce Yelp API call volume.
3. Improve response speed while preserving most ranking quality.

### Decision

Proceed with a **hybrid snapshot + bounded live fallback** model and ship in small slices, starting with top-city snapshot serving before deeper cache infrastructure.

### Options considered

| Option | Impact | Tradeoff | Recommendation |
|---|---|---|---|
| A. Keep fully live and tune delays/retries only | Small-medium quality gain | Still request-budget fragile | Not sufficient alone |
| B. Hybrid cache (top cities precomputed + live fallback) | High reliability, high speed, large Yelp call reduction | Slight data staleness | **Recommended** |
| C. Full precompute-only for all traffic | Max speed/cost control | No freshness for long-tail cities | Too rigid for now |

### Recommended architecture

Use a **hybrid model**:

- Top cities: serve precomputed snapshots (fast path, no live Yelp/Google calls).
- Non-top cities: run live path with stricter request-budget controls.
- Public mode: prefer cheaper/faster behavior.
- Private mode: allow richer live enrichment.

### Success metrics

Track these before/after metrics (same city set, same day window):

- Yelp-populated rows in merged output (public mode, top 10 cities)
- p50 / p95 `/api/search` latency
- Yelp API calls per 100 searches
- `% snapshot_served` for top-city traffic
- `% google_only` fallback rate for covered cities

---

## Target Behavior

Normal mode:
1. Fetch Yelp 50 rows **and** Google prominent 60 rows concurrently.
2. Enrich Yelp rows via existing Google enrichment loop (unchanged).
3. Deduplicate prominent rows against enriched Yelp rows.
4. Append unique Google-prominent rows as additions.
5. Cap at `MERGED_RESULT_LIMIT` and return.

Fallback mode: unchanged.

## Design Constraints

| Constraint | Detail |
|---|---|
| Never drop Yelp rows | All 50 Yelp rows appear regardless of prominent overlap |
| Additive, non-breaking | Prominent failures degrade gracefully to Yelp-only (current behavior) |
| No new `Restaurant` type fields | Existing shape is sufficient — Google-only additions are identifiable by `yelp.review_count === 0` |
| Cloudflare subrequest budget | 3 extra prominent calls must be budgeted; reduce `DEPLOYED_MAX_GOOGLE_ENRICHMENTS` from 48 → 45 |
| Scoring works as-is | `hasRealRatings` in `scoring.ts` already handles single-source rows (Google-only additions get Google-only score) |
| No feature flag | Strictly additive; easy to revert via git if issues arise |

## Constants

| Constant | Value | Status |
|---|---|---|
| `YELP_RESULT_LIMIT` | 50 | existing, unchanged |
| `GOOGLE_PROMINENT_MAX_RESULTS` | 60 | existing, unchanged |
| `MERGED_RESULT_LIMIT` | 80 | **new** |
| `MAX_GOOGLE_ENRICHMENTS` | 50 | existing, unchanged (local) |
| `DEPLOYED_MAX_GOOGLE_ENRICHMENTS` | **45** | existing, reduce from 48 (frees 3 subrequests for prominent pages) |
| `MERGED_DEDUPE_NAME_THRESHOLD` | 0.5 | **new** — name similarity floor for secondary dedupe |
| `MERGED_DEDUPE_DISTANCE_METERS` | 250 | **new** — max distance for secondary dedupe (matches `GOOGLE_DISTANCE_THRESHOLD_METERS`) |

---

## Implementation Steps

### Phase A — Parallel Fetch Plumbing

**Goal:** Run Yelp and prominent fetch concurrently so prominent latency (~6s) is hidden behind Yelp + enrichment time.

1. In `POST` handler, after validating `city`, launch prominent fetch in parallel with Yelp:
   ```
   const prominentPromise = fetchGoogleProminentRows(city).catch(() => ({ restaurants: [], warnings: [] }));
   // ... existing Yelp fetch + error handling ...
   ```
   The `.catch()` ensures a prominent failure never blocks or fails the request.

2. Reduce `DEPLOYED_MAX_GOOGLE_ENRICHMENTS` from 48 to 45.

3. Add `MERGED_RESULT_LIMIT = 80` constant.

4. Update `buildRestaurantFromGooglePlacesNewResult` to accept an `idPrefix` parameter (default `"google-fallback"`). Normal-mode callers pass `"google-prominent"`.

### Phase B — Dedupe + Merge Engine

**Goal:** After enrichment, deduplicate and merge.

The dedupe must happen **after** Yelp Google-enrichment completes because enrichment populates `google.place_id` on Yelp rows, which is the strongest dedupe key.

#### Dedupe algorithm (new helper: `dedupeProminentAgainstYelp`)

Input: enriched Yelp rows + prominent rows.
Output: list of unique prominent rows to append.

```
1. Build Set<string> of all non-null google.place_id from Yelp rows.
2. For each prominent row:
   a. If prominent.google.place_id exists AND is in the Yelp place_id set → skip (duplicate).
   b. Else: compare against each Yelp row using name similarity (≥ 0.5) AND
      geo distance (≤ 250m). If any Yelp row matches → skip (duplicate).
   c. Else → keep as unique addition.
3. Return kept rows.
```

#### Merge logic (in `POST` handler, after enrichment + scoring)

```
1. const prominentResult = await prominentPromise;
2. const uniqueAdditions = dedupeProminentAgainstYelp(enrichedYelpRows, prominentResult.restaurants);
3. Apply Michelin matching to additions.
4. Score additions via computeCombinedScores.
5. Concatenate: [...scoredYelpRows, ...scoredAdditions].slice(0, MERGED_RESULT_LIMIT).
```

#### Warning behavior

- Prominent fetch failures in normal mode do NOT surface user-facing warnings (Yelp data is complete and primary).
- Prominent metrics are logged via diagnostics only.
- Existing enrichment warnings for Yelp rows remain unchanged.

### Phase C — UI + Table Adjustments

The table component already handles variable-length arrays and requires no structural changes. Two small refinements:

1. **Yelp columns for Google-only additions:** Currently the table renders `yelp.rating = 0` as `"0.0"` and `yelp.review_count = 0` as `"0"`. Change `RestaurantTable` to display `"-"` when `yelp.review_count === 0` for the Yelp Rating, Yelp Reviews, and Price columns. This gives the same visual treatment as Google-only fallback mode but on a per-row basis.

2. **Default sort stays "Yelp Reviews":** Google-only additions have `yelp.review_count = 0` and will sort to the bottom, which is correct — they are supplementary. No sort changes needed.

3. **(Optional, deferred):** Add a subtle "G" badge or tooltip on Google-only addition rows. Not required for initial ship.

### Phase D — Diagnostics Update

Extend `SearchDiagnostics` with:

```ts
google_prominent_fetched: number;   // rows fetched from prominent API
google_prominent_added: number;     // unique additions after dedupe
google_prominent_deduped: number;   // rows matched to existing Yelp rows
google_prominent_ms: number | null; // wall-clock time for prominent fetch
```

Log these in the `yelp_primary` mode diagnostics block.

### Phase E — Tests

#### Route tests (`tests/phase1-routes.test.ts`)

| Test | Assertion |
|---|---|
| Merged list count > 50 when unique prominent rows exist | Return count = Yelp rows + unique Google additions |
| Duplicate suppression by `place_id` | Prominent row with same `place_id` as enriched Yelp row is excluded |
| Duplicate suppression by name + geo | Prominent row with similar name and close coordinates is excluded |
| Yelp rows always retained | All 50 Yelp rows present even when prominent returns 60 |
| Graceful degradation | If prominent fetch throws, response has exactly 50 Yelp rows with no extra warnings |
| `DEPLOYED_MAX_GOOGLE_ENRICHMENTS` is 45 | Verify the constant directly or via mock call count |
| Cap at `MERGED_RESULT_LIMIT` | If Yelp 50 + unique prominent 40 > 80, output is capped at 80 |

#### UI tests (`tests/page.test.ts`)

| Test | Assertion |
|---|---|
| Renders > 50 rows | Table row count matches merged array length |
| Google-only additions show "-" for Yelp columns | Rows with `yelp.review_count === 0` render dashes |
| Sort stability | Sorting by each key produces deterministic order with mixed-source rows |

### Phase F — Snapshot Read Path (Top Cities)

**Goal:** Remove most live API cost/latency for high-traffic cities.

1. Add a city snapshot manifest + loader (JSON/CSV source under `data/precompute/...` or object storage path).
2. In `/api/search`, before live orchestration:
   - normalize city key
   - if snapshot exists and is fresh enough, return snapshot payload
   - include metadata: `snapshot_served: true`, `snapshot_generated_at`
3. Keep response contract unchanged for table rendering.
4. Public mode defaults to snapshot-first behavior.
5. Add explicit source metadata in response diagnostics only (not required in table UI).

**Implementation status:** implemented in route code with fallback-safe behavior.
**Rollout note:** snapshot files must be available in deployed runtime to realize Phase F cost/latency gains.

### Phase G — Live Path Budget Reduction

**Goal:** Keep live mode viable for uncached cities on free plan.

1. Reuse prefetched Google prominent rows to prefill Yelp rows before `/api/google` calls.
2. Limit Google enrichment to rows still missing Google after prefill.
3. Public-profile backfill lookup cap (`YELP_PROMINENT_LOOKUP_LIMIT_PUBLIC`) applied on top of deployed limit via `getProminentLookupLimit(isLocal, appProfile)`.
4. Keep Yelp backfill sequential + throttled and tolerant to transient 429s.
5. Hard backfill time-budget guardrail (`YELP_PROMINENT_BACKFILL_BUDGET_MS`, default 30s):
   - checked at loop top, after inter-row delay, before/after retry cooldown, before/after exponential 429 cooldown
   - stops immediately when exceeded with `devLog` and sets `budgetExceeded` flag
6. Granular skip diagnostics in `YelpBackfillMetrics`:
   - `skipped_lookup_cap`: rows beyond the lookup limit (intentional policy)
   - `skipped_time_budget`: rows skipped because time budget was exceeded
   - `skipped_rate_limit_stop`: rows skipped because consecutive-429 cutoff was reached
   - `skipped_no_api_key`: rows skipped because Yelp API key was unavailable
   - `skipped_budget`: backward-compatible aggregate of the above
7. `request_budget_mode` refined: `"degraded"` only for actual runtime failures (time budget, rate-limit stop, missing API key); intentional lookup-cap skips stay `"normal"`.

**Implementation status:** implemented.

**Environment variables (all optional):**
- `YELP_PROMINENT_LOOKUP_LIMIT_PUBLIC` — extra cap for public profile (default: no additional cap beyond deployed limit)
- `YELP_PROMINENT_BACKFILL_BUDGET_MS` — total budget for backfill loop per request in ms (default: 30000)

**Test coverage:**
- Budget=0 immediate stop: verifies zero Yelp API calls, `skipped_time_budget: 1`, `request_budget_mode: "degraded"`
- Public lookup cap: verifies `YELP_PROMINENT_LOOKUP_LIMIT_PUBLIC=1` limits attempts to 1, `skipped_lookup_cap: 1`, `request_budget_mode: "normal"`
- Partial budget exhaustion: deterministic `Date.now()` mock verifies one attempt then stop, `skipped_time_budget: 1`

### Phase H — Dynamic City TTL Cache (Non-top cities)

**Goal:** Reduce repeated live calls for long-tail searches.

1. Add cache layer for non-top cities (in-memory slice first, KV/R2/D1 later).
2. Cache key: normalized city + profile + algorithm version.
3. TTL strategy:
   - popular non-top cities: longer TTL
   - low-frequency cities: shorter TTL
4. Serve cached payload when present.
5. (Deferred optional) asynchronously refresh after TTL expiry.

**Implementation status:** implemented (in-memory TTL slice).
- Read path implemented before live orchestration for non-snapshot cities.
- Write path implemented for successful live responses (`yelp_primary` and healthy `google_fallback`).
- Profile-aware keying implemented (`city slug + APP_PROFILE + cache version`).
- Bounded cache implemented (`SEARCH_DYNAMIC_CITY_CACHE_MAX_ENTRIES`) with expiry pruning.
- Cache telemetry implemented (`cache_hit`, `cache_write`, `cache_write_skipped_reason`, `cache_ttl_minutes`).
- Current limitation: backend is process-local memory; shared persistent cache backend is deferred.

### Phase I — Profile-specific policy

**Goal:** Keep public website stable/cheap while preserving private richness.

1. Public profile defaults:
   - snapshot-first
   - lower live backfill budget
   - stricter timeout/attempt caps
2. Private profile defaults:
   - live-first (or snapshot-assisted)
   - higher enrichment/backfill budget
3. Keep shared codepath with profile-based policy object to avoid split-codebase drift.

**Implementation status:** implemented.
- Centralized profile policy object (`SearchProfilePolicy`) now controls enrichment/backfill knobs.
- Public/private behavior remains shared-codepath and profile-driven.

### Phase J — Observability and Safeguards

**Goal:** Measure quality/cost tradeoffs and prevent regressions.

Add diagnostics fields:

```ts
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
request_budget_mode: "normal" | "degraded";
```

Track per-city:
- median runtime
- Yelp-populated row count
- warning rates
- fallback rates

**Implementation status:** implemented.
- All diagnostics fields are emitted from all four modes (`yelp_primary`, `google_fallback`, `snapshot`, `yelp_error`) with consistent schema.
- Granular skip-reason counters are populated from `YelpBackfillMetrics` in `yelp_primary` mode; other modes emit zeros.
- Remaining (deferred optional): centralized metric aggregation/reporting workflow (out of scope for route-level work).

### Ship Slice S1 (recommended first implementation)

Scope this as the first production-safe iteration:

1. Phase F core path for top cities (read-only snapshot serve in public mode).
2. Minimal Phase G controls already in place plus diagnostics alignment.
3. Phase J instrumentation fields required to evaluate impact.

Out of scope for S1:
- Dynamic non-top cache store integration (Phase H).
- Background refresh orchestration.
- Private-mode policy tuning.

S1 exit criteria:
- Top-city public searches return snapshot results consistently.
- Public p95 latency improves versus live path baseline.
- Yelp API calls for top-city traffic materially decrease.
- No regression in fallback behavior for non-top cities.

---

---

## Execution Order (Updated)

Implemented baseline:
1. Phase A (plumbing + constants)
2. Phase B (dedupe + merge)
3. Phase C (UI tweak)
4. Phase D (diagnostics)
5. Phase E (tests)

Current optimization state:
6. Phase F (snapshot read path) — code complete, rollout depends on snapshot artifact availability
7. Phase G (live-path budget reduction) — implemented: hard time budget, public lookup cap, granular skip diagnostics, refined degraded-mode semantics
8. Phase I (profile policy) — implemented: centralized policy object for profile-specific knobs
9. Phase H (dynamic city cache) — implemented: in-memory TTL read/write slice with telemetry and bounded pruning
10. Phase J (instrumentation) — implemented: consistent schema across all modes, reasoned skip counters

Next recommended rollout:
11. Verify deployed environment serves `public/precompute` assets (or set `SEARCH_SNAPSHOT_HTTP_BASE_URL` to external snapshot host)

## Archived Optional Steps (for now)

These are explicitly deferred to keep current scope focused and avoid overbuilding:

1. Phase H persistent shared backend for dynamic cache (KV/R2/D1).
2. Phase H async refresh / stale-while-revalidate after TTL expiry.
3. Phase J centralized metrics aggregation/reporting dashboard.

---

## Latency Analysis

| Step | Current (ms) | With merged (ms) | Notes |
|---|---|---|---|
| Yelp fetch | ~800 | ~800 | Unchanged |
| Google enrichment (50 rows) | ~3000 | ~2700 | 45 rows deployed; same local |
| Google prominent (3 pages) | N/A | ~6000 | Hidden behind enrichment (parallel) |
| Merge + dedupe | N/A | <10 | In-memory, negligible |
| **Total wall-clock** | **~3800** | **~6000** | Prominent is the long pole when enrichment finishes fast |

Worst case adds ~2-3s when enrichment completes before all 3 prominent pages. Acceptable for the value of additional rows.

---

## Cloudflare Subrequest Budget

```
Live deployed subrequests are variable and can exceed practical free-tier reliability when all steps run:
  Yelp seed fetch                                 =  1
  Google enrichment (bounded, dynamic)            =  0..45
  Google prominent pages                          =  1..3
  Yelp prominent backfill lookups                 =  0..N
  Michelin                                         =  0

Snapshot-served requests avoid this live budget almost entirely.
```

---

## Manual QA Checklist

1. **San Francisco:** total rows > 50; no obvious duplicates; Yelp columns show dashes for Google-only additions.
2. **Los Angeles / New York:** merged list quality; map links work for all rows.
3. **Seoul:** fallback mode still triggers with "Limited Yelp coverage" banner (regression check).
4. **Sort by each key:** Google-only additions sort to bottom on Yelp columns; Combined Score reflects single-source correctly.

## Validation Commands

```
npm.cmd run lint
npm.cmd run build
npm.cmd run test -- tests/phase1-routes.test.ts
npm.cmd run test
```

## Risks

| Risk | Mitigation |
|---|---|
| Dedupe misses: same restaurant appears twice | Dual-key strategy (place_id + name/geo); monitor in QA |
| False positive dedupe: different restaurants collapsed | Name threshold (0.5) + distance cap (250m) are conservative |
| Prominent adds latency on slow connections | Parallel fetch hides most; graceful degradation on timeout |
| Cloudflare free-tier request pressure still reduces Yelp-filled rows in live mode | Prioritize snapshot path for top cities; keep live mode bounded and profile-aware |
| Snapshot staleness for top cities | Include generated timestamp; scheduled refresh cadence |
| Snapshot files may be missing in deployed runtime | Treat snapshot as optional fast path; preserve live fallback; add deployment checklists for artifact availability |
| Cache inconsistency across profile modes | Include `APP_PROFILE` in cache key and diagnostics |
| Larger table may overwhelm users | 80-row cap; default sort keeps best Yelp rows on top |

## Exit Criteria

- Normal city searches return > 50 rows when unique prominent restaurants exist.
- All 50 Yelp rows are always present.
- No obvious duplicates in QA cities.
- Google-only additions display correctly (dashes for Yelp columns, valid map links, valid scores).
- Fallback mode is unaffected.
- All automated tests pass.
