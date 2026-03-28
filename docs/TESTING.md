# Claire Eats Testing Guide

> How we verify changes in this repository.
> Last updated: 2026-03-24

---

## 1. Scope

This document covers testing for `claire-eats` (Next.js App Router + TypeScript).

---

## 2. Baseline Commands (PowerShell)

Run from the repository root:

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run test
npm.cmd run test:ci
```

Use `npm.cmd` in PowerShell to avoid execution-policy issues with `npm.ps1`.

---

## 3. Test Stack

- Unit/component tests: `Vitest`
- React component assertions: `@testing-library/react`
- DOM environment: `jsdom`

Config files:

- `vitest.config.ts`
- `tests/setup.ts`

---

## 4. What to Test First

Prioritize logic that protects core product constraints:

1. Yelp-first row inclusion behavior
2. Google enrichment acceptance/rejection logic
3. Michelin nearest-match threshold logic
4. Public/private profile behavior and response redaction contracts
5. API route partial-failure warning contracts

---

## 5. Focused Test Commands

Use focused runs first, then broaden only if needed:

```powershell
# UI and profile behavior (public/private table behavior)
npm.cmd run test -- tests/page.test.tsx

# Route orchestration and API contracts
npm.cmd run test -- tests/phase1-routes.test.ts

# Full suite when changes are broad
npm.cmd run test
```

For public/private changes, run both `tests/page.test.tsx` and `tests/phase1-routes.test.ts`.

---

## 6. Manual QA Checklist (MVP)

- Search by city returns a table when Yelp succeeds
- Missing Google data does not remove Yelp rows
- Rows without enrichment render fallback values (`-`)
- API failures display clear error states without crashing
- `GET /api/config` returns clear `CONFIG_ERROR` when required env values are missing
- Analytics events are logged in dev when searching, opening map links, and leaving/replacing a results view (`/api/events`)
- Public profile hides score/CSV, shows `Popularity Rank`, and keeps disabled sort controls
- Public API response returns `combined_score: null` for all rows
- In development, mismatched `APP_PROFILE` vs `NEXT_PUBLIC_APP_PROFILE` logs a warning

---

## 7. CI Quality Gate

Minimum gate for pull requests:

1. `npm.cmd run lint`
2. `npm.cmd run build`
3. `npm.cmd run test:ci`

For Phase 1 route/backend changes, ensure tests cover:
- Yelp normalization and required-field filtering behavior
- Google fallback codes (`GOOGLE_TIMEOUT`, `GOOGLE_RATE_LIMITED`, `GOOGLE_UPSTREAM_ERROR`)
- Search route warning propagation and top-20 enrichment cap

---

## 8. Notes for Agents

- Keep tests focused on behavior, not implementation details.
- Add or update tests in the same change for new logic.
- Prefer small, deterministic tests over broad end-to-end mocks.
