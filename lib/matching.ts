type Coordinates = {
  lat: number;
  lng: number;
};

type YelpMatchInput = {
  name: string;
  lat: number | null;
  lng: number | null;
};

type GoogleCandidate = {
  name: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  user_ratings_total: number | null;
  place_id: string | null;
};

type GoogleEnrichment = {
  rating: number | null;
  review_count: number | null;
  place_id: string | null;
  maps_url: string | null;
};

const EARTH_RADIUS_METERS = 6_371_000;
const GOOGLE_DISTANCE_THRESHOLD_METERS = 100;

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

export function hasNameOverlap(a: string, b: string) {
  const normalizedA = normalizeName(a);
  const normalizedB = normalizeName(b);

  if (!normalizedA || !normalizedB) return false;
  if (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA)) return true;

  const tokensA = new Set(normalizedA.split(" ").filter((token) => token.length >= 3));
  const tokensB = new Set(normalizedB.split(" ").filter((token) => token.length >= 3));

  if (tokensA.size === 0 || tokensB.size === 0) return false;

  let overlapCount = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlapCount += 1;
  }

  return overlapCount >= 2;
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
  candidate: GoogleCandidate | null,
): GoogleEnrichment {
  if (!candidate) return rejectGoogleEnrichment();

  const nameAccepted =
    candidate.name !== null ? hasNameOverlap(yelpRestaurant.name, candidate.name) : false;

  const coordinateAccepted =
    yelpRestaurant.lat !== null &&
    yelpRestaurant.lng !== null &&
    candidate.lat !== null &&
    candidate.lng !== null
      ? getDistanceMeters(
          { lat: yelpRestaurant.lat, lng: yelpRestaurant.lng },
          { lat: candidate.lat, lng: candidate.lng },
        ) <= GOOGLE_DISTANCE_THRESHOLD_METERS
      : false;

  if (!nameAccepted && !coordinateAccepted) {
    return rejectGoogleEnrichment();
  }

  return {
    rating: candidate.rating,
    review_count: candidate.user_ratings_total,
    place_id: candidate.place_id,
    maps_url: buildMapsUrl(candidate.place_id),
  };
}
