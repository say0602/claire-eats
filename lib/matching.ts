type Coordinates = {
  lat: number;
  lng: number;
};

type YelpMatchInput = {
  name: string;
  lat: number | null;
  lng: number | null;
  address?: string | null;
  postal_code?: string | null;
};

type GoogleCandidate = {
  name: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  user_ratings_total: number | null;
  place_id: string | null;
  address?: string | null;
  postal_code?: string | null;
};

type GoogleEnrichment = {
  rating: number | null;
  review_count: number | null;
  place_id: string | null;
  maps_url: string | null;
};

const EARTH_RADIUS_METERS = 6_371_000;
const GOOGLE_DISTANCE_THRESHOLD_METERS = 250;
const GOOGLE_MATCH_MIN_SCORE = 0.2;

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function getDistanceMeters(a: Coordinates, b: Coordinates) {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const haversine =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const centralAngle = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));

  return EARTH_RADIUS_METERS * centralAngle;
}

function normalizeName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeAddress(address: string) {
  return address
    .toLowerCase()
    .replace(/\b(street|st)\b/g, "st")
    .replace(/\b(avenue|ave)\b/g, "ave")
    .replace(/\b(road|rd)\b/g, "rd")
    .replace(/\b(boulevard|blvd)\b/g, "blvd")
    .replace(/\b(suite|ste)\b/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getStreetLine(address: string) {
  const [streetLine] = address.split(",");
  return streetLine ?? address;
}

function tokenSet(value: string) {
  return new Set(value.split(" ").filter((token) => token.length >= 2));
}

function overlapRatio(a: Set<string>, b: Set<string>) {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }
  return overlap / Math.max(a.size, b.size);
}

function extractStreetNumber(value: string) {
  const match = value.match(/\b\d+[a-z]?\b/i);
  return match ? match[0].toLowerCase() : null;
}

export function normalizePostalCode(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/\d{5}/);
  return match ? match[0] : null;
}

export function getNameSimilarity(a: string, b: string) {
  const normalizedA = normalizeName(a);
  const normalizedB = normalizeName(b);
  if (!normalizedA || !normalizedB) return 0;
  if (normalizedA === normalizedB) return 1;
  if (compactName(normalizedA) === compactName(normalizedB)) return 0.95;
  if (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA)) return 0.9;

  const tokensA = tokenSet(normalizedA);
  const tokensB = tokenSet(normalizedB);
  return overlapRatio(tokensA, tokensB);
}

export function getAddressSimilarity(
  yelpAddress: string | null | undefined,
  yelpPostalCode: string | null | undefined,
  googleAddress: string | null | undefined,
  googlePostalCode: string | null | undefined,
) {
  if (!yelpAddress && !yelpPostalCode) return 0;
  if (!googleAddress && !googlePostalCode) return 0;

  const normalizedYelpAddress = yelpAddress ? normalizeAddress(yelpAddress) : "";
  const normalizedGoogleAddress = googleAddress ? normalizeAddress(googleAddress) : "";
  const yelpStreet = normalizedYelpAddress ? getStreetLine(normalizedYelpAddress) : "";
  const googleStreet = normalizedGoogleAddress ? getStreetLine(normalizedGoogleAddress) : "";
  const yelpStreetNumber = yelpStreet ? extractStreetNumber(yelpStreet) : null;
  const googleStreetNumber = googleStreet ? extractStreetNumber(googleStreet) : null;

  const tokenScore =
    yelpStreet && googleStreet
      ? overlapRatio(tokenSet(yelpStreet), tokenSet(googleStreet))
      : 0;
  const streetNumberScore =
    yelpStreetNumber && googleStreetNumber && yelpStreetNumber === googleStreetNumber ? 1 : 0;
  const yelpZip = normalizePostalCode(yelpPostalCode ?? yelpAddress ?? null);
  const googleZip = normalizePostalCode(googlePostalCode ?? googleAddress ?? null);
  const zipScore = yelpZip && googleZip && yelpZip === googleZip ? 1 : 0;

  return Math.min(1, tokenScore * 0.6 + streetNumberScore * 0.25 + zipScore * 0.15);
}

function getDistanceScore(yelpRestaurant: YelpMatchInput, candidate: GoogleCandidate) {
  if (
    yelpRestaurant.lat === null ||
    yelpRestaurant.lng === null ||
    candidate.lat === null ||
    candidate.lng === null
  ) {
    return 0;
  }

  const distanceMeters = getDistanceMeters(
    { lat: yelpRestaurant.lat, lng: yelpRestaurant.lng },
    { lat: candidate.lat, lng: candidate.lng },
  );
  if (distanceMeters > GOOGLE_DISTANCE_THRESHOLD_METERS) return 0;
  return 1 - distanceMeters / GOOGLE_DISTANCE_THRESHOLD_METERS;
}

export function hasNameOverlap(a: string, b: string) {
  return getNameSimilarity(a, b) >= 0.5;
}

export function buildMapsUrl(placeId: string | null) {
  if (!placeId) return null;
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
}

export function rejectGoogleEnrichment(): GoogleEnrichment {
  return {
    rating: null,
    review_count: null,
    place_id: null,
    maps_url: null,
  };
}

export function resolveGoogleEnrichment(
  yelpRestaurant: YelpMatchInput,
  candidateOrCandidates: GoogleCandidate | GoogleCandidate[] | null,
): GoogleEnrichment {
  if (!candidateOrCandidates) return rejectGoogleEnrichment();
  const candidates = Array.isArray(candidateOrCandidates) ? candidateOrCandidates : [candidateOrCandidates];
  if (candidates.length === 0) return rejectGoogleEnrichment();

  let bestCandidate: GoogleCandidate | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const nameScore = candidate.name ? getNameSimilarity(yelpRestaurant.name, candidate.name) : 0;
    const distanceScore = getDistanceScore(yelpRestaurant, candidate);
    const addressScore = getAddressSimilarity(
      yelpRestaurant.address,
      yelpRestaurant.postal_code,
      candidate.address,
      candidate.postal_code,
    );
    const score = nameScore * 0.5 + distanceScore * 0.3 + addressScore * 0.2;
    const hasStrongSignal = nameScore >= 0.45 || distanceScore >= 0.6 || addressScore >= 0.7;

    if (hasStrongSignal && score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  if (!bestCandidate || bestScore < GOOGLE_MATCH_MIN_SCORE) {
    return rejectGoogleEnrichment();
  }

  return {
    rating: bestCandidate.rating,
    review_count: bestCandidate.user_ratings_total,
    place_id: bestCandidate.place_id,
    maps_url: buildMapsUrl(bestCandidate.place_id),
  };
}
