# Private Mode Access Guide

This guide explains how to keep and access your private feature-rich version separately from a public-safe version.

## Target setup

- **Private mode:** full personal workflow (CSV, score, total reviews visible)
- **Public mode:** compliance-oriented UI (no CSV, no score display, popularity-rank presentation)

Both run from the same codebase using `APP_PROFILE`.

## 1) Local private access (recommended baseline)

Use local environment:

- Set both `APP_PROFILE=private` and `NEXT_PUBLIC_APP_PROFILE=private` in `.env.local`
- Run:
  - `npm.cmd run dev`
- Open local app URL (for your machine only).

This is the safest and simplest way to keep private capabilities non-public.

### Local quick start

1. Create/update `.env.local`:
   - `APP_PROFILE=private`
   - `NEXT_PUBLIC_APP_PROFILE=private`
2. Start app:
   - `npm.cmd run dev`
3. Open:
   - `http://localhost:3000` (or your active dev port)

If you run both public/private locally at once, use separate terminals and ports:

- Private: `APP_PROFILE=private`, port `3001`
- Private: `NEXT_PUBLIC_APP_PROFILE=private`, port `3001`
- Public: `APP_PROFILE=public`, `NEXT_PUBLIC_APP_PROFILE=public`, port `3002`

## 2) Hosted private access (optional)

If you want private mode on the web (not just localhost):

1. Create a separate private deployment target/domain.
2. Set `APP_PROFILE=private` and `NEXT_PUBLIC_APP_PROFILE=private` on that private deployment.
3. Protect access using one of:
   - Cloudflare Access (recommended)
   - IP allowlist
   - basic auth (if available in your hosting stack)

Do not expose the private-mode URL publicly.

## 3) Public deployment setup

For your public domain:

- Set `APP_PROFILE=public`.
- Set `NEXT_PUBLIC_APP_PROFILE=public`.
- Verify public mode behavior before go-live:
  - no CSV button
  - no score display
  - popularity-rank style table presentation (rank only, no total-review number)

Important:

- `NEXT_PUBLIC_APP_PROFILE` is consumed by client-rendered UI and is treated as a build/deploy-time value.
- If you switch profile values, redeploy that environment so the client bundle reflects the new profile.

## 4) Suggested environment matrix

| Environment | APP_PROFILE | Access |
|---|---|---|
| Local dev (personal) | `private` (`NEXT_PUBLIC_APP_PROFILE=private`) | local machine |
| Private hosted (optional) | `private` (`NEXT_PUBLIC_APP_PROFILE=private`) | protected by Access/auth |
| Public production | `public` (`NEXT_PUBLIC_APP_PROFILE=public`) | public internet |

## 5) Practical Cloudflare pattern

If you continue with Cloudflare:

1. Keep your existing public project for public mode (`APP_PROFILE=public`, `NEXT_PUBLIC_APP_PROFILE=public`).
2. Add a second project or environment for private mode (`APP_PROFILE=private`, `NEXT_PUBLIC_APP_PROFILE=private`).
3. Put private host behind Cloudflare Access policy (email allowlist).

This gives you clean separation without duplicating code.

## 6) Safety checklist before publishing public mode

- [ ] Confirm `APP_PROFILE=public` is set on public deployment
- [ ] Confirm `NEXT_PUBLIC_APP_PROFILE=public` is set on public deployment
- [ ] Verify CSV button is absent
- [ ] Verify score display is absent
- [ ] Verify `Total Reviews` label is absent
- [ ] Verify `Popularity Rank` is rank-only (no combined numeric value)
- [ ] Verify table still functions (search, sort, map links)
- [ ] Verify provider attribution/compliance requirements are satisfied

## 7) If private mode must never leave your machine

Keep private mode local-only:

- run only via `npm.cmd run dev`
- do not deploy private profile anywhere
- use precomputed private CSV snapshots locally for your personal research flow

This is the lowest-risk path for keeping your current version personal.

## 8) Suggested deployment split

Use separate domains/environments:

- Public site: `eat.yourdomain.com` -> `APP_PROFILE=public`
- Private site (optional hosted): `eat-private.yourdomain.com` -> `APP_PROFILE=private`, `NEXT_PUBLIC_APP_PROFILE=private` + Cloudflare Access

This makes accidental profile mix-ups less likely.
