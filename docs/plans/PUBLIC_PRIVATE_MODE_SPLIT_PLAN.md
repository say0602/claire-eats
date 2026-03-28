---
status: implemented
owner: claire
---

# Public vs Private Mode Split Plan

## Current Status

All planned phases are implemented (Phase 1-4).

Delivered outcomes:

- Profile plumbing via `APP_PROFILE` / `NEXT_PUBLIC_APP_PROFILE` with shared helper.
- Public mode: no CSV, no score, no numeric total-reviews display, rank-only `Popularity Rank`.
- Private mode: current personal workflow preserved (CSV + score + total reviews).
- Public API payload shaping: `combined_score` redacted (`null`) in public profile.
- Coverage: UI/profile tests in `tests/page.test.tsx` and route-level redaction tests in `tests/phase1-routes.test.ts`.

Optional follow-up:

- Add development-time warning when `APP_PROFILE` and `NEXT_PUBLIC_APP_PROFILE` are misaligned.

## Goal

Keep the current feature-rich experience for private use, while shipping a safer public mode in the same codebase.

Private mode keeps:
- CSV export
- weighted combined score
- "Total Reviews" label and display

Public mode removes/hides:
- CSV export
- weighted score display
- "Total Reviews" display as a raw combined count

Public mode can still use total-review logic internally for ordering, but presents it as a non-numeric `Popularity Rank`.

## Decision (explicit)

To avoid ambiguity in implementation, public mode will use:

- `Popularity Rank` column as plain row rank (`1, 2, 3, ...`) based on current default ordering logic.
- No numeric `Total Reviews` output in the table.
- No score pill/score number output in the table.

## Why this approach

- One codebase avoids duplicate maintenance and drift.
- Public risk-sensitive behavior is isolated by mode configuration.
- Private mode remains unchanged for personal/internal workflows.

## Mode model

Use a single runtime profile variable:

- `APP_PROFILE=private`
- `APP_PROFILE=public`

Default behavior:
- local development defaults to `private`
- public deployment explicitly sets `APP_PROFILE=public`

Important:

- Client-rendered UI reads `NEXT_PUBLIC_APP_PROFILE`, which behaves as a build/deploy-time value.
- In practice, both `APP_PROFILE` and `NEXT_PUBLIC_APP_PROFILE` should be set to the same value per environment.

## Proposed Scope

### Public mode

1. Remove CSV export UI action.
2. Hide score column/pill and all score sort paths.
3. Replace `Total Reviews` header with `Popularity Rank`.
4. Keep default ordering by current total-review logic, but show only rank numbers (`1..N`) in `Popularity Rank`.
5. Preserve Yelp/Google source-native columns already shown (`Yelp Rating`, `Yelp Reviews`, `Google Rating`, `Google Reviews`).
6. Keep merged-list behavior and fallback behavior unchanged unless policy review requires additional restrictions.
7. Remove score/total-review tooltip copy from public mode.

### Private mode

1. Keep current table and sorting behavior as-is.
2. Keep CSV export and score tooltips as-is.
3. Keep current matching/backfill behaviors as-is.

## Non-goals

- No backend rewrite.
- No separate app/repo.
- No changes to existing matching algorithm as part of this split.
- No legal interpretation in code; this plan only implements a configurable product split.

## File-level plan

Primary files to touch:

- `app/page.tsx`
  - Read/propagate app profile to UI components.
  - Keep existing search behavior; only presentation changes by profile.

- `lib/app-profile.ts` (new)
  - Centralize profile parsing/validation from `APP_PROFILE`.
  - Return explicit union type (`"private" | "public"`) with safe default.

- `components/RestaurantTable.tsx`
  - Gate `Download CSV` by profile.
  - Gate score column/sort controls by profile.
  - Add public-mode `Popularity Rank` presentation using row index.
  - Ensure public mode does not expose total-review numeric values.

- `components/ScorePill.tsx`
  - No logic change required; only hidden in public mode.

- `lib/types.ts` (optional/minimal)
  - Add optional UI mode type if needed for cleaner props.

- `tests/page.test.tsx`
  - Add profile-specific rendering tests:
    - public mode hides CSV and score
    - public mode shows `Popularity Rank`
    - private mode preserves existing behavior

- `tests/table-utils.test.ts`
  - Add sorting/render utility coverage for mode-specific table behavior.

- `.env.example`
  - Add `APP_PROFILE` with documented allowed values.

- `scripts/precompute-cities.mjs` (optional follow-up)
  - Keep private/internal only; do not expose precompute artifacts in public mode by default.

- `docs/PRD.md` and `docs/plans/archive/2026-03/IMPLEMENTATION_PLAN.md`
  - Update product documentation to reflect dual-profile behavior.

## Implementation Phases

### Phase 1 - Runtime mode plumbing

1. Add a centralized helper for profile resolution (server-safe + client-safe usage pattern).
2. Add `APP_PROFILE` to env docs.
3. Wire profile value from page-level component into table.

Exit criteria:
- app renders in both modes without runtime errors.

### Phase 2 - Public UI restrictions

1. Hide CSV action in public profile.
2. Hide score column and score sort option in public profile.
3. Replace total review display with `Popularity Rank` column (row index only).
4. Keep ordering logic stable and deterministic.

Exit criteria:
- public mode contains no CSV control and no score display.
- table still sorts and renders correctly.

### Phase 3 - Private parity

1. Verify private mode remains current behavior (no regression).
2. Verify existing CSV tests and score tests remain valid under private mode.

Exit criteria:
- no private feature regression.

### Phase 4 - Test + doc hardening

1. Add/adjust unit and page tests for both profiles.
2. Update docs and deployment notes for profile configuration.
3. Add route-level profile tests to confirm public responses do not expose derived score fields.

Exit criteria:
- lint/build/tests pass.
- docs explicitly explain which profile is used where.

## Testing plan

Automated:
- `npm.cmd run lint`
- `npm.cmd run build`
- `npm.cmd run test -- --run tests/page.test.tsx tests/table-utils.test.ts`

Manual:
- Private mode:
  - CSV button visible and functional
  - score column visible
  - total reviews visible
- Public mode:
  - no CSV button
  - no score column
  - `Popularity Rank` shown as integer rank (`1..N`)
  - no visible total-review numeric value
  - sort and map links still work

## Risks and mitigations

1. **Risk:** UI mode branching causes test brittleness.
   - **Mitigation:** Keep mode logic centralized and add explicit tests per mode.

2. **Risk:** Public mode still exposes derived metrics unintentionally.
   - **Mitigation:** Add UI assertions and route-level payload assertions (public mode).

3. **Risk:** Deployment misconfiguration sets wrong profile.
   - **Mitigation:** Document explicit env requirements for both `APP_PROFILE` and `NEXT_PUBLIC_APP_PROFILE`; add mismatch warning.

4. **Risk:** Future UI changes accidentally re-enable restricted fields in public mode.
   - **Mitigation:** Add profile-specific tests that assert absence of `Download CSV`, `Score`, and `Total Reviews`.

## Rollout recommendation

1. Implement behind `APP_PROFILE`.
2. Deploy a preview with `APP_PROFILE=public` for verification.
3. Keep local/private workflows on `APP_PROFILE=private`.
4. After acceptance, promote public profile to production domain.

## Acceptance checklist

- Public preview:
  - `Download CSV` not present
  - `Score` column not present
  - `Total Reviews` label not present
  - `Popularity Rank` present and numeric rank only
- Private preview:
  - Current behavior unchanged (CSV + score + total reviews preserved)
