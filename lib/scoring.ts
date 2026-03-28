import type { Restaurant } from "@/lib/types";

function toTenPointRating(rating: number | null): number | null {
  if (rating === null || !Number.isFinite(rating)) return null;
  return Math.min(10, Math.max(0, rating * 2));
}

function weightedAverage(values: Array<{ score: number | null; weight: number }>) {
  let weightedSum = 0;
  let weightSum = 0;

  for (const value of values) {
    if (value.score === null) continue;
    if (!Number.isFinite(value.score)) continue;
    if (!Number.isFinite(value.weight) || value.weight <= 0) continue;

    weightedSum += value.score * value.weight;
    weightSum += value.weight;
  }

  if (weightSum === 0) return null;
  return weightedSum / weightSum;
}

function hasRealRatings(source: { rating: number | null; review_count: number | null }): boolean {
  return source.rating !== null && source.rating > 0 && source.review_count !== null && source.review_count > 0;
}

export function computeRawCombinedScore(restaurant: Pick<Restaurant, "yelp" | "google">) {
  const yelpScore = hasRealRatings(restaurant.yelp) ? toTenPointRating(restaurant.yelp.rating) : null;
  const googleScore = hasRealRatings(restaurant.google) ? toTenPointRating(restaurant.google.rating) : null;
  const yelpWeight = yelpScore === null ? 0 : restaurant.yelp.review_count;
  const googleWeight = googleScore === null ? 0 : (restaurant.google.review_count ?? 0);

  return weightedAverage([
    { score: yelpScore, weight: yelpWeight },
    { score: googleScore, weight: googleWeight },
  ]);
}

function roundToOneDecimal(value: number) {
  return Math.round(value * 10) / 10;
}

export function computeCombinedScores(restaurants: Restaurant[]): Restaurant[] {
  return restaurants.map((restaurant) => {
    const rawScore = computeRawCombinedScore(restaurant);
    return {
      ...restaurant,
      combined_score: rawScore === null ? null : roundToOneDecimal(rawScore),
    };
  });
}
