---
status: active
---

- `components/ScorePill.tsx` (created)
- `lib/types.ts` (created)
- `lib/matching.ts` (created)
- `lib/scoring.ts` (created)
- `lib/michelin.ts` (created)
- `data/michelin.json` (created)
- `scripts/convert-michelin.ts` (created)

## Goal

Build and ship the first working version of Claire Eats as a table-first restaurant research app for travelers:

- User enters a city.
- System fetches Yelp restaurants as the primary list.
- System enriches each result with Google Places (best-effort).
- UI shows one sortable comparison table with map deep-links.

The MVP target is a usable, reliable workflow in one week. Phase 1.5 then adds the highest-value quality boost (combined score default sort + better loading/error UX).

Scope note: in `docs/PRD.md`, the "MVP flow" section describes the end-to-end ideal flow, while delivery scope is defined by the PRD "Phases" section. This plan follows those phase boundaries: combined score is delivered in Phase 1.5A, while Michelin UI is archived for now.

## PRD → Plan Mapping (Scope Alignment)

- **PRD 5.1 City search** → Phase 1: `SearchBar` + `/api/search` input validation
- **PRD 5.2 Yelp aggregation** → Phase 1: `/api/yelp` + normalization into shared `Restaurant` shape
- **PRD 5.2 Google enrichment** → Phase 1: `/api/google` + best-effort enrichment of top N Yelp rows
- **PRD 5.3 Matching logic** → Phase 1: `lib/matching.ts` (Google acceptance ~100m / overlap)
- **PRD 5.4 Combined score** → Phase 1.5A: `lib/scoring.ts` + default sort by score
- **PRD 5.5 Table view + 5.6 Sorting** → Phase 1: table with Yelp-first sorting; Phase 1.5A: add Score column + score sort becomes default
- **PRD 9 Edge cases** → Phase 1+: warnings contract, partial result rendering, fallback states

## Design Decisions

- **Initial architecture: monorepo app-first with Next.js App Router.**
  - Since no app code exists yet, start from a clean Next.js baseline and keep frontend + backend in one deployable unit.
- **Server-side API orchestration.**
  - Keep Yelp/Google keys private in server routes.
  - Normalize provider payloads in one place before reaching the client.
- **Provider budget and resilience first.**
  - Treat Yelp/Google API quotas and latency as first-class constraints from MVP.
  - Use bounded concurrency, timeouts, and fallback behavior for 429/5xx failures.
- **Yelp as canonical row source.**
  - Yelp decides row inclusion; Google enriches existing rows.
  - This guarantees stable rows even when enrichment providers fail.
- **Coordinate-first matching strategy.**
  - Use Haversine threshold checks for Google acceptance where possible.
  - Keep string overlap as a lightweight fallback for Google.
- **Partial data is a valid result.**
  - Missing Google fields render as empty values, never row deletion.
  - Users should always get usable output from a city search when Yelp succeeds.
- **Phase split mirrors PRD.**
  - Phase 1: core search + table + Yelp-first flow.
  - Phase 1.5A: combined score + score-first sorting.
  - Phase 1.5B: loading/error UX + instrumentation for PRD metrics.
- **Operational defaults are explicit for MVP (tunable constants, not PRD requirements).**
  - Yelp result limit: `30` rows per city search.
  - Google enrichment: top `20` Yelp rows, max concurrency `5`.
  - Upstream timeout budget: `2500ms` per Google request.
  - Retry policy: `1` retry for `429`/`5xx` with exponential backoff (base `300ms` + jitter).
- **Compliance and attribution are ship blockers.**
  - Provider terms (display attribution, caching/retention limits) must be verified before launch.

## Non-goals

- User accounts, sign-in, or personalized data
- Reservation/booking workflows
- Perfect cross-provider entity matching
- NLP or review-text analysis
- Itinerary generation or trip planning assistant features
- Monetization features (affiliate, paid tiers) in this iteration

## Assumptions

- Yelp coordinates are present for the large majority of returned businesses.
- Google Places quota is sufficient for the MVP defaults (`20` enrichments per search).
- Initial launch target is desktop-first; mobile polish beyond basic responsiveness is Phase 2.

## Implementation Steps

### Phase 0 - Foundations (Day 0-1)

1. [x] **Bootstrap the app workspace**
   - Initialize Next.js (App Router + TypeScript) in this repository root (`claire-eats`).
   - Add linting/formatting defaults and verify local run.

2. [x] **Create baseline folder structure**
   - Create `app/`, `components/`, `lib/`, `data/`, `scripts/`, and `tests/`.
   - Add placeholder files for API routes and shared modules to establish integration boundaries.

3. [x] **Define shared contracts**
   - Implement `lib/types.ts` with the PRD restaurant shape and API response envelopes.
   - Include strict nullable semantics for enrichment fields.

4. [x] **Environment + secrets contract**
   - Define `.env.example` with:
     - `YELP_API_KEY`
     - `GOOGLE_MAPS_API_KEY`
   - Add server-side validation utility that returns clear config errors.
   - Add runtime config check endpoint: `GET /api/config`.

5. [x] **Testing baseline**
   - Configure `Vitest` + `@testing-library/react` + `jsdom` for this Next.js repo.
   - Add scripts: `test`, `test:watch`, `test:ci`.
   - Define CI quality gate commands: `npm.cmd run lint`, `npm.cmd run build`, `npm.cmd run test:ci`.
   - Add first utility-level test (Haversine or score math) to verify CI/local setup.
   - Create `docs/TESTING.md` with project-specific test and manual QA guidance.

6. [x] **Data-source compliance checklist**
   - Capture Yelp/Google/Michelin usage constraints (attribution, retention, caching).
   - Add required attribution notes to UI/docs as needed for launch readiness.

**Phase 0 verification snapshot (2026-03-24)**

- `npm.cmd run lint` -> pass
- `npm.cmd run build` -> pass
- `npm.cmd run test:ci` -> pass

### Phase 1 - MVP Core (Day 1-5)

1. [x] **Implement Yelp proxy endpoint (`app/api/yelp/route.ts`)**
   - Input: `city` string.
   - Output: normalized Yelp restaurant list with required fields.
   - Add timeout and clear upstream failure mapping.

2. [x] **Implement Google proxy endpoint (`app/api/google/route.ts`)**
   - Input: `{ name, city, lat?, lng? }`.
   - Query Places Text Search using `"{restaurant_name} {city}"`.
   - Return first candidate payload with required enrichment fields.
   - Ensure `maps_url` is always a valid deep-link when `place_id` exists:
     - Preferred: construct `maps_url` from `place_id` (no Place Details call required).
     - Optional: add Place Details only if needed for additional fields later.
   - Handle quota and upstream failures (`429`/`5xx`) with typed fallback responses.
   - Apply timeout `2500ms`; retry once on `429`/`5xx` using backoff + jitter.

3. [x] **Implement matching logic (`lib/matching.ts`)**
   - Name-overlap helper.
   - Distance helper with 100m Google acceptance threshold.
   - Result acceptance/rejection function returning either normalized google data or nulls.

4. [x] **Implement orchestrator endpoint (`app/api/search/route.ts`)**
   - Validate input.
   - Fetch Yelp list.
   - Enrich top `20` Yelp rows with Google using bounded concurrency (`5` max).
   - Enforce per-request enrichment cap and timeout budget to limit cost/latency.
   - Return unified rows plus `warnings[]` for partial failures.
   - Standardize warning codes: `GOOGLE_TIMEOUT`, `GOOGLE_RATE_LIMITED`, `GOOGLE_UPSTREAM_ERROR`, `PARTIAL_ENRICHMENT`.
   - Standardize response envelope:
     - success: `{ city, restaurants, warnings }`
     - failure: `{ city, restaurants: [], warnings, error: { code, message } }`

**Phase 1 (Steps 1-4) verification snapshot (2026-03-24)**

- `npm.cmd run lint` -> pass
- `npm.cmd run build` -> pass
- `npm.cmd run test:ci` -> pass
- Route tests verify:
  - Yelp row normalization + coordinate filtering
  - Google retry/fallback behavior (`OVER_QUERY_LIMIT`, `5xx`, timeout paths)
  - Search orchestrator caps enrichment to top `20` and preserves Yelp rows on partial failures

5. [x] **Build search + table UI**
   - `components/SearchBar.tsx`: city input, submit button, Enter key behavior.
   - `components/RestaurantTable.tsx`: render MVP columns and sortable headers.
   - `app/page.tsx`: state wiring, loading, empty, and error states.

6. [x] **MVP sorting and formatting**
   - Default sort by Yelp review count.
   - Add helper formatting for counts and fallback placeholders (`-`).
   - Ensure map link button opens valid Google Maps URL when available.

**Phase 1 (Steps 5-6) verification snapshot (2026-03-25)**

- `npm.cmd run lint` -> pass
- `npm.cmd run build` -> pass
- `npm.cmd run test:ci` -> pass
- Note: additional UI-focused tests were added after initial MVP cut (network error handling, sort switching).
- UI checks implemented:
  - Search form submit + Enter key behavior
  - Loading / empty / error states
  - Sortable table headers with default Yelp review sort
  - Review count formatting (`4.2k`) and fallback placeholders (`-`)
  - Google map deep-link button only when `maps_url` exists

**Phase 1 UI scope (explicit):**

- **Table columns (Phase 1 / MVP)**
  - `#` (row index)
  - `Restaurant` (Yelp name)
  - `Yelp Rating`
  - `Yelp Reviews` (default sort)
  - `Google Rating` (may be `-`)
  - `Google Reviews` (may be `-`)
  - `Price` (may be `-`)
  - `Cuisine` (tags)
  - `Map` (Open button → `maps_url` when available; otherwise disabled / `-`)
- **Not in Phase 1**
  - `Michelin` column
  - `Score` / combined score column
  - Sort by `Google Reviews` (deferred to Phase 1.5A; Phase 1 displays Google counts but keeps sorting Yelp-first)

**Local setup notes (discovered during Phase 1 verification)**

- Copy `.env.example` to `.env.local` (preferred) or `.env` (also works locally) and set:
  - `YELP_API_KEY`
  - `GOOGLE_MAPS_API_KEY`
- Google Places requests in this app are made server-side via `app/api/google/route.ts`.
  - A Google API key restricted to **HTTP referrers (websites)** will be rejected with `REQUEST_DENIED`.
  - Use an unrestricted server key (or IP-restricted key in production) with Places enabled and billing active.

### Phase 1.5A - Data Value (Day 5-6)

> Archived scope note (2026-03-24): Michelin UI was removed because current dataset coverage is too sparse for reliable user value. Michelin-specific implementation remains non-blocking and can be re-enabled later.

1. [x] **Michelin data pipeline (archived)**
   - Create `scripts/convert-michelin.ts` to transform source data into app-ready JSON.
   - Generate and store `data/michelin.json` in a city-indexed shape for fast lookups.
   - Add schema validation for generated output.

2. [x] **Michelin matching runtime (`lib/michelin.ts`) (archived)**
   - Load/filter Michelin data by city.
   - Nearest-neighbor coordinate match with 80m threshold.
   - Return `{ award, green_star, matched }` or empty values.

3. [x] **Scoring engine (`lib/scoring.ts`)**
   - Implement raw formula from PRD.
   - Handle single-source fallback if one provider is missing.
   - Min-max normalize score to 0-10 and round to 1 decimal.

4. [x] **Integrate Michelin + score into search response (Michelin archived for UI)**
   - Extend orchestrator output with `michelin` and `combined_score`.
   - Keep Michelin non-blocking so rows still render if no match exists.

**Phase 1.5A (Steps 1-4) verification snapshot (2026-03-24)**

- `npm.cmd run lint` -> pass
- `npm.cmd run build` -> pass
- `npm.cmd run test:ci` -> pass

5. [x] **UI upgrades**
   - Add `ScorePill.tsx`.
   - Keep Michelin badge implementation archived (not rendered in table UI).
   - Add `Score` column.
   - Make combined score default sort.
   - Add optional sort by Google reviews.

**Phase 1.5A (Step 5) verification snapshot (2026-03-24)**

- `npm.cmd run lint` -> pass
- `npm.cmd run build` -> pass
- `npm.cmd run test:ci` -> pass (9 files, 55 tests)

**Phase 1.5A UI scope (explicit):**

- **Table columns added in Phase 1.5A**
  - `Score` (0–10, 1 decimal; `-` if insufficient data)
- **Sorting (PRD-aligned)**
  - Default sort becomes `Score` (descending)
  - Keep sort option for `Yelp Reviews`
  - Add sort option for `Google Reviews`
- **Still out of scope in Phase 1.5A**
  - Michelin column in table UI (archived due to sparse match coverage)
  - “Perfect” cross-provider matching improvements (Phase 2)
  - Any changes that make Michelin affect numeric score (PRD says Michelin is a badge only)

### Phase 1.5B - UX + Measurement (Day 6-7)

1. [ ] **UX hardening**
   - [x] Add city input suggestion dropdown to guide valid city formatting (custom filtered list in `SearchBar`).
   - Improve loading skeleton and retry behavior.
   - Better error copy for invalid city vs upstream API failures.
   - Keep table stable during refetches to avoid jumpy UI.

**Phase 1.5B (UX hardening, city suggestions) verification snapshot (2026-03-24)**

- `npm.cmd run lint` -> pass
- `npm.cmd run build` -> pass
- `npm.cmd run test:ci` -> pass (9 files, 56 tests)
- UI checks implemented:
  - Typing in city input shows filtered suggestion dropdown.
  - Clicking a suggestion writes full city value into the input.
  - Dropdown closes on `Escape`.

2. [ ] **Analytics instrumentation (PRD metrics)**
   - Event: `search_submitted` with `{ city, session_id, ts }`.
   - Event: `map_open_clicked` with `{ restaurant_id, city, sort_key, rank, session_id, ts }`.
   - Event: `results_view_closed` with `{ city, dwell_ms, session_id, ts }`.
   - Derive PRD metrics from event stream: map-open count/session, repeat city searches, time-on-table.
   - Keep MVP implementation minimal (no vendor lock-in required for Phase 1.5B):
     - Emit events via a single internal logger (server route or server action), and verify in dev via logs.
     - Ensure the event interface can be swapped later (PostHog/GA/etc.) without touching UI call-sites.

### Phase 2 - Hardening (Parallel + post-ship)

1. [ ] **Unit tests**
   - `lib/matching.ts`: overlap and distance edge cases.
   - `lib/scoring.ts`: both-sources, one-source, and normalization edge cases.
   - `lib/michelin.ts`: city filtering and threshold behavior.

2. [ ] **Route integration tests**
   - Mock Yelp/Google providers.
   - Verify partial-result behavior and warning contracts.

3. [ ] **Performance controls**
   - Add explicit result limits and concurrency caps.
   - Add request-level timeout budgets to keep UI responsive.
   - Validate search latency target: `<5s` typical and `<10s` p95 in target deploy environment.

4. [ ] **Telemetry and diagnostics**
   - Log provider latency and failure rates.
   - Capture match rates (Google accepted, Michelin matched) for tuning.

5. [ ] **Docs and handoff**
   - Update setup instructions and environment docs.
   - Document known matching limitations and future tuning plan.

## Phase Exit Gates

- **Phase 0 exit gate**
  - App boots locally, type checks, and has at least one passing utility test.
  - Env validation fails fast with clear error messages.
- **Phase 1 exit gate**
  - End-to-end city search works with Yelp-first rows and partial Google failure handling.
  - Concurrency cap + timeout budget + `warnings[]` contract are verified in tests.
  - Default operational limits are enforced (`30` Yelp rows, top `20` Google enrichments, concurrency `5`, timeout `2500ms`).
- **Phase 1.5A exit gate**
  - Combined score is default sort and single-source fallback works.
  - Michelin is archived for UI and does not block table rendering or sort behavior.
- **Phase 1.5B exit gate**
  - Loading/error UX is hardened for partial Google failures and slow networks.
  - PRD metric events are emitted and can be verified (at minimum via dev logs).

## Success Criteria

- A user can search a city and get a populated table without leaving the page.
- Yelp success still returns usable rows even if Google enrichment partially fails.
- Map links open Google Maps for enriched rows.
- Combined score displays 0.0-10.0 (1 decimal), and default sorting uses this score in Phase 1.5A.
- Key PRD behaviors are test-covered (matching thresholds, score fallback, partial failure handling).
- Measured performance is acceptable: search responses are typically under `5s` and p95 under `10s`.
- Usage instrumentation supports PRD validation:
  - At least 3 map-open clicks can be measured per session.
  - Return search behavior and time-on-table are tracked.

## Open Questions

- Do we use Places Text Search only, or add Place Details for stronger map metadata?
- Where should Michelin source refresh happen (manual script run vs scheduled pipeline)?
- Do we cache city search results in-memory during MVP demos to reduce repeated API costs?

Target resolution: all open questions should be resolved by the end of Phase 1 to avoid blocking Phase 1.5.
