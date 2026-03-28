---
status: implemented
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

---

## Execution Order

1. Phase A (plumbing + constants) — small, isolated
2. Phase B (dedupe + merge) — core logic
3. Phase C (UI tweak) — single component change
4. Phase D (diagnostics) — non-blocking
5. Phase E (tests) — validates everything

Phases A+B can be implemented together. Phase C is independent. Phase D+E wrap up.

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
Deployed subrequests per search:
  Yelp direct handler → 1 external fetch         =  1
  Google enrichment (45) → 1 external fetch each  = 45
  Google prominent (3 pages) → 1 external fetch   =  3
  Michelin (static, no fetch)                     =  0
                                                   ----
  Total                                           = 49  (within 50 limit)
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
npm.cmd run test -- --run tests/phase1-routes.test.ts
npm.cmd run test
```

## Risks

| Risk | Mitigation |
|---|---|
| Dedupe misses: same restaurant appears twice | Dual-key strategy (place_id + name/geo); monitor in QA |
| False positive dedupe: different restaurants collapsed | Name threshold (0.5) + distance cap (250m) are conservative |
| Prominent adds latency on slow connections | Parallel fetch hides most; graceful degradation on timeout |
| Cloudflare subrequest budget tight (49/50) | Tested constant; further reduction possible by skipping enrichment for prominent-matched rows (future optimization) |
| Larger table may overwhelm users | 80-row cap; default sort keeps best Yelp rows on top |

## Exit Criteria

- Normal city searches return > 50 rows when unique prominent restaurants exist.
- All 50 Yelp rows are always present.
- No obvious duplicates in QA cities.
- Google-only additions display correctly (dashes for Yelp columns, valid map links, valid scores).
- Fallback mode is unaffected.
- All automated tests pass.
