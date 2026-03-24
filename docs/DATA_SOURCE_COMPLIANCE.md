# Data Source Compliance Checklist

Last updated: 2026-03-24

## Purpose

Track launch-blocking usage constraints for Yelp, Google Places, and Michelin source data.

## Provider Rules (Phase 0 baseline)

### Yelp (primary source of rows)

- Yelp is the canonical source for row inclusion in search results.
- Verify and implement required Yelp attribution in UI before launch.
- Review Yelp API terms for any data retention and caching restrictions.

### Google Places (enrichment only)

- Google data enriches Yelp rows only; it does not create or remove rows.
- Verify and implement required Google attribution in UI before launch.
- Review Google Maps Platform terms for retention/caching and display limits.

### Michelin dataset (static, bundled source)

- Michelin data is loaded from a local static dataset in this repository.
- Michelin data only enriches existing Yelp rows.
- Confirm source license and attribution requirements when publishing.

## Launch Readiness Checklist

- [ ] Yelp attribution text and links are visible in the UI.
- [ ] Google attribution text and links are visible in the UI.
- [ ] Michelin source attribution is visible in docs/UI.
- [ ] Retention/caching behavior matches provider terms.
- [ ] Terms review date and owner are recorded before production release.
