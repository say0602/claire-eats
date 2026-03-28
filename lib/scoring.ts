import type { Restaurant } from "@/lib/types";

function weightedLogScore(rating: number, reviewCount: number) {
  if (!Number.isFinite(rating) || !Number.isFinite(reviewCount) || reviewCount <= 0) {
    return null;
  }

  return rating * Math.log(reviewCount + 1);
}

export function normalizeScoreToTenPointScale(value: number, min: number, max: number) {
  // Neutral fallback when all raw scores are identical.
  if (max <= min) return 5;

  const normalized = ((value - min) / (max - min)) * 10;
  return Math.min(10, Math.max(0, normalized));
}

export function computeRawCombinedScore(restaurant: Pick<Restaurant, "yelp" | "google">) {
  const yelpRaw = weightedLogScore(restaurant.yelp.rating, restaurant.yelp.review_count);
  const googleRaw =
    restaurant.google.rating !== null && restaurant.google.review_count !== null
      ? weightedLogScore(restaurant.google.rating, restaurant.google.review_count)
      : null;

  if (yelpRaw !== null && googleRaw !== null) {
    return (yelpRaw + googleRaw) / 2;
  }

  if (yelpRaw !== null) return yelpRaw;
  if (googleRaw !== null) return googleRaw;
  return null;
}

function roundToOneDecimal(value: number) {
  return Math.round(value * 10) / 10;
}

export function computeCombinedScores(restaurants: Restaurant[]): Restaurant[] {
  const rawScores = restaurants.map((restaurant) => computeRawCombinedScore(restaurant));
  const validRawScores = rawScores.filter((score): score is number => score !== null);

  if (validRawScores.length === 0) {
    return restaurants.map((restaurant) => ({ ...restaurant, combined_score: null }));
  }

  const min = Math.min(...validRawScores);
  const max = Math.max(...validRawScores);

  return restaurants.map((restaurant, index) => {
    const rawScore = rawScores[index];
    const combinedScore =
      rawScore === null ? null : roundToOneDecimal(normalizeScoreToTenPointScale(rawScore, min, max));

    return {
      ...restaurant,
      combined_score: combinedScore,
    };
  });
}
