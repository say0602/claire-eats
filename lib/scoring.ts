export function normalizeScoreToTenPointScale(value: number, min: number, max: number) {
  // Neutral fallback when all raw scores are identical.
  if (max <= min) return 5;

  const normalized = ((value - min) / (max - min)) * 10;
  return Math.min(10, Math.max(0, normalized));
}
