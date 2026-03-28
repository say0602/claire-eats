# Claire Eats — Product Requirements Document

**Version:** 1.0 · **Status:** Draft · **Last updated:** March 2026

---

## 1. Overview

Claire Eats is a food research tool for travelers. Enter a city, and the app aggregates restaurant data from Yelp and Google Places, computes a combined quality score, and presents everything in a clean, sortable table for quick comparison.

> **Core value proposition:** Research restaurants for your next trip — fast, structured, and without switching between five different tabs.

### Product profiles (Public vs Private)

Claire Eats supports two runtime profiles in the same codebase:

- **Public profile (`APP_PROFILE=public`)**: compliance-oriented UI.
  - No CSV export
  - No combined/weighted score display
  - No numeric combined review totals display
  - Uses a **Popularity Rank** (rank-only) presentation for default ordering
- **Private profile (`APP_PROFILE=private`)**: personal/internal workflow.
  - CSV export enabled
  - Combined score enabled (review-count weighted, 0–10)
  - Total reviews visible and sortable

The public profile is intended for the public website; the private profile is intended for local or access-controlled use.

---

## 2. Goals

### Primary goal

Enable users to quickly compare and select restaurants in an unfamiliar city, replacing ad-hoc searches across Yelp, Google Maps, and Michelin with a single structured view.

### Success metrics (initial)

- User clicks through to 3+ restaurants (Map / Open) in a single session
- Return usage: same user searches a second city
- Average time-on-table > 90 seconds

---

## 3. Non-Goals

The following are explicitly out of scope for the initial release.

| Feature | Reason for exclusion |
|---|---|
| Reservation / booking | Adds auth + third-party complexity; not core to research |
| User accounts / login | No personalization needed at MVP stage |
| Automatic itinerary generation | Different product surface; out of scope |
| Perfect restaurant matching | Best-effort matching is sufficient for MVP |
| Review text analysis / NLP | Phase 3+ concern |

---

## 4. User Flow

### MVP flow

1. User enters a city name (e.g. "San Francisco")
2. User clicks Search
3. System fetches restaurants from Yelp Business Search API (top 50 by Yelp review count)
4. System enriches Yelp rows via Google Places Text Search (best-effort)
5. System fetches Google Places (New) prominent restaurants (up to 60) and appends unique additions after dedupe
6. Results are rendered as a sortable table
7. User sorts, inspects, and opens Google Maps links to decide

Profile-specific UI behavior:

- **Public**: default ordering shown as `Popularity Rank` (rank-only), no CSV, no combined score display
- **Private**: combined score + total reviews visible, CSV export available

---

## 5. Core Features

### 5.1 City search

- Input: free-text city name
- Trigger: Search button or Enter key
- Validation: non-empty string

---

### 5.2 Restaurant data aggregation

#### Yelp (primary source)

| Field | Notes |
|---|---|
| `name` | Required |
| `rating` | Required |
| `review_count` | Required |
| `price` | Optional ($, $$, $$$, $$$$) |
| `categories` | Array of cuisine labels |
| `coordinates` (lat/lng) | Required — used for Michelin matching |

#### Google Places (enrichment + merged additions)

For each Yelp result, search Google Places using:

```
{restaurant_name} {city}
```

| Field | Notes |
|---|---|
| `rating` | Google star rating |
| `user_ratings_total` | Total review count |
| `place_id` | Unique identifier |
| `maps_url` | Direct Google Maps deep-link |

Normal mode behavior:

- Yelp remains the primary source (top 50 rows).
- Google Places (New) prominent results (up to 60) are fetched in parallel and deduped against Yelp rows.
- Unique Google-prominent rows are appended (merged output capped at 80).
- Yelp backfill is attempted for Google-prominent additions to recover Yelp rating/review_count where possible.

#### Michelin Guide (static dataset, archived for UI)

Bundled as a pre-processed JSON file derived from the open-source [ngshiheng/michelin-my-maps](https://github.com/ngshiheng/michelin-my-maps) dataset (~6,500 restaurants, updated annually). Michelin runtime matching remains in the backend, but Michelin UI is currently archived and not shown in the table.

| Field | Values |
|---|---|
| `Award` | `"1 Star"`, `"2 Stars"`, `"3 Stars"`, `"Bib Gourmand"` |
| `GreenStar` | Boolean — Michelin sustainability distinction |
| `Latitude` / `Longitude` | Used for coordinate-based matching |

---

### 5.3 Matching logic

#### Google enrichment matching

- Evaluate the top 5 Google Places results for each query (with location bias using Yelp coordinates).
- Score each candidate using a weighted model: name similarity (50%), distance (30%), address overlap (20%).
- Accept the best candidate if it has a strong signal (name >= 0.45, distance >= 0.6, or address >= 0.7) and meets the minimum confidence score (0.2).
- Reject (null Google data) if no candidate meets the threshold.

#### Michelin matching

- Filter Michelin dataset to the searched city
- For each Yelp restaurant, find the nearest Michelin entry by Haversine distance
- Accept match if distance < 80 m
- Coordinate matching is preferred over name matching to handle transliterations and abbreviations

> **Note:** Imperfect matches are acceptable at MVP. The coordinate-first approach is significantly more reliable than string matching alone.

---

### 5.4 Combined score

A single numeric score that converts Yelp and Google star ratings to a common 10-point scale and combines them using review-count weighting.

**Private profile only:** The score is displayed in `APP_PROFILE=private`. Public profile does not display a combined score.

```
yelp10      = yelp_rating × 2
google10    = google_rating × 2
yelpWeight  = yelp_review_count
googleWeight= google_review_count
score       = (yelp10*yelpWeight + google10*googleWeight) / (yelpWeight + googleWeight)
```

The score is absolute (not normalized relative to the result set) and displayed as a **0–10 value** for readability.

| Property | Behavior |
|---|---|
| Range | 0.0 – 10.0 (displayed to 1 decimal place) |
| Weighting | Review-count weighted (higher review count has more influence) |
| Missing data | If only one source has real data (rating > 0 and review_count > 0), score uses that source alone |
| Placeholder zeros | Google-only fallback rows have Yelp rating/reviews = 0; these are treated as missing, not averaged |
| Michelin signal | Michelin-starred restaurants surface a badge; stars do not affect the numeric score |

---

### 5.5 Table view

The primary UI surface. All data for a city is presented in a single scrollable, sortable table.

#### Public profile table (compliance-oriented)

| Column | Source | Notes |
|---|---|---|
| Popularity Rank | Computed | Rank-only (`1..N`) based on default ordering logic |
| Restaurant | Yelp / Google | Name |
| Yelp Rating | Yelp | Star display + numeric |
| Yelp Reviews | Yelp | Formatted (e.g. 4.2k) |
| Google Rating | Google | Star display + numeric |
| Google Reviews | Google | Formatted |
| Price | Yelp | $–$$$$ |
| Cuisine | Yelp | Tag pills |
| Map | Google | "Open" button → Google Maps deep-link |

Public profile explicitly does **not** show:

- CSV export
- Combined score
- Numeric combined review totals (e.g., Yelp+Google)

#### Private profile table (personal/internal)

| Column | Source | Notes |
|---|---|---|
| # | — | Row index by current sort |
| Restaurant | Yelp / Google | Name |
| Score | Computed | 0–10 combined score |
| Total Reviews | Computed | Yelp Reviews + Google Reviews |
| Yelp Rating | Yelp | Star display + numeric |
| Yelp Reviews | Yelp | Formatted (e.g. 4.2k) |
| Google Rating | Google | Star display + numeric |
| Google Reviews | Google | Formatted |
| Price | Yelp | $–$$$$ |
| Cuisine | Yelp | Tag pills |
| Map | Google | "Open" button → Google Maps deep-link |

Additional UX:

- `Download CSV` action exports the currently sorted result list (private profile only).
- Tooltips on `Score` and `Total Reviews` explain calculation semantics.

---

### 5.6 Sorting

| Option | Default? |
|---|---|
| Public: Popularity Rank | Yes (default) |
| Private: Total Reviews | Yes (default) |
| Private: Combined Score | No |
| Yelp Reviews | No |
| Yelp Rating | No |
| Google Rating | No |
| Google Reviews | No |

All sortable columns display a sort indicator icon by default to signal interactivity. Yelp-specific sort options are disabled in Google-only fallback mode.

---

## 6. Data Model

```ts
type Restaurant = {
  id: string
  name: string
  city: string

  yelp: {
    rating: number
    review_count: number
    price: string | null        // '$' | '$$' | '$$$' | '$$$$'
    categories: string[]
    lat: number
    lng: number
    address?: string | null     // display address from Yelp
    postal_code?: string | null // ZIP / postal code from Yelp
  }

  google: {
    rating: number | null
    review_count: number | null
    place_id: string | null
    maps_url: string | null
  }

  michelin: {
    award: '1 Star' | '2 Stars' | '3 Stars' | 'Bib Gourmand' | null
    green_star: boolean
    matched: boolean            // true = coordinate match found
  }

  combined_score: number | null  // 0–10, review-count weighted; null if insufficient data
}
```

---

## 7. Phases

### Phase 1 — MVP
**Target: ship in 1 week**

| | |
|---|---|
| **In scope** | City search · Yelp API (50 rows by review count) · Google Places Text Search (top-5 candidate matching with location bias) · Google Places (New) prominent list fetch (up to 60) with merged additions after dedupe · Yelp backfill for prominent additions (best-effort) · Table UI · Google Maps link · Sort by Total Reviews/Yelp/Google rating/reviews/score · Google-only fallback when Yelp has no coverage |
| **Out of scope** | Michelin UI (archived) · saved lists · login · perfect matching |
| **Success criteria** | A real traveler can use it to research restaurants before a trip |

---

### Phase 1.5 — Quick wins
**Target: days after MVP**

- Combined score column (absolute 10-point, review-count weighted)
- Expanded sort controls (Yelp rating/reviews, Google rating/reviews, score) with visible sort icons
- Add `Total Reviews` sort and make it default
- Add public vs private profiles (public removes score/CSV/combined totals; private keeps personal workflow)
- Review count formatting (4.2k)
- Loading UX improvements
- Error handling and fallback states
- Google-only fallback mode when Yelp has no usable coverage
- Michelin UI archived due to sparse/low-confidence coverage (backend matching remains available)

> **Why now:** Combined score and stronger sorting controls immediately make the table more useful than raw Yelp/Google numbers alone, while fallback UX increases city coverage reliability.

---

### Phase 2 — Smart layer
**Target: 2–4 weeks post-MVP**

- Better matching: further tuning of weighted scoring model (name/distance/address), additional candidate evaluation strategies
- Prominent list quality/perf tuning: optimize merge quality and Yelp backfill hit-rate/latency trade-offs
- UI enhancements: hover card with full details, cuisine tag styling, price visual improvement, mobile layout
- Score tuning: Bayesian average option, review-count confidence weighting

---

### Phase 3 — Expansion
**Target: 6–8 weeks post-MVP**

- Additional data sources: Michelin Bib Gourmand highlights, World's 50 Best, local "top lists" per city
- User features: saved/favorited restaurants, export to Notion, shareable list URLs
- Monetization: affiliate links (OpenTable, Resy), premium filters (dietary, ambiance)

---

## 8. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Next.js (App Router) + Tailwind CSS | |
| Backend | Next.js Server Actions or API Routes | Keeps infra minimal |
| Yelp | Business Search API | Primary restaurant list |
| Google | Places Text Search + Places API (New) Text Search | Enrichment + prominent additions |
| Michelin | Static JSON (build-time, ngshiheng dataset) | No API call; refreshed annually |
| Deployment | Cloudflare | API keys via environment variables |

### Folder structure

```
claire-eats/
├── app/
│   ├── page.tsx                  # Main search + table UI
│   ├── api/
│   │   ├── search/route.ts       # Orchestrates Yelp + Google + Michelin
│   │   ├── yelp/route.ts         # Yelp Business Search proxy
│   │   └── google/route.ts       # Google Places proxy
├── components/
│   ├── SearchBar.tsx
│   ├── RestaurantTable.tsx
│   ├── MichelinBadge.tsx
│   └── ScorePill.tsx
├── lib/
│   ├── michelin.ts               # Load + query static JSON
│   ├── matching.ts               # Haversine + name matching logic
│   └── scoring.ts                # Combined score computation
├── data/
│   └── michelin.json             # Pre-processed from ngshiheng dataset
└── scripts/
    └── convert-michelin.ts       # CSV → city-indexed JSON
```

---

## 9. Edge Cases

| Scenario | Handling |
|---|---|
| Google data unavailable | Display dash; row remains in table |
| No Michelin match found | No user-visible impact (Michelin UI is archived) |
| Incorrect Michelin coordinate match | Acceptable at MVP; flagged for Phase 2 tuning |
| Duplicate Yelp results | Permitted at MVP (de-duplication in Phase 2) |
| Yelp or Google API failure | Fallback UI with error message; partial results if possible. If Yelp has no coverage, Google-only fallback with explicit banner. |
| City with no Michelin coverage | Column visible but empty; no UI error |
| Combined score with one source only | Compute from available source; no penalty |

---

## 10. Key Trade-offs

| Trade-off | Decision | Rationale |
|---|---|---|
| Accuracy vs. speed | Speed first | Travelers want fast answers; edge-case mismatches are tolerable |
| Perfect matching vs. usable product | Usable first | 80% correct instantly beats 100% correct after 5 minutes |
| Feature breadth vs. focus | Single table view | One surface, done well, beats five mediocre surfaces |
| Michelin API vs. static data | Static JSON | Free, zero-latency, annually refreshed — no API licensing needed |

---

## 11. Future Monetization

| Model | Notes |
|---|---|
| Affiliate links | OpenTable / Resy reservation links with commission |
| Premium tier | Custom filters (dietary restrictions, ambiance, distance radius) |
| Saved lists | Freemium — basic saving free, advanced export / sharing paid |

---

## 12. One-Line Product Definition

> A table-first research tool that combines Yelp and Google signals so travelers can decide where to eat — in under 60 seconds.

---

## 13. Product Principles

- **Ship fast, not perfect** — a usable product today beats a flawless product next quarter
- **One surface, done well** — the table is the product; resist feature sprawl
- **Data over opinion** — scoring is transparent and grounded in public signals
- **Traveler-first** — every decision is evaluated through the lens of someone planning a trip
