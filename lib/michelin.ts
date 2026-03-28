export type MichelinAward = "1 Star" | "2 Stars" | "3 Stars" | "Bib Gourmand";

export type MichelinMatch = {
  award: MichelinAward | null;
  green_star: boolean;
  matched: boolean;
};

export const EMPTY_MICHELIN_MATCH: MichelinMatch = {
  award: null,
  green_star: false,
  matched: false,
};

import michelinData from "@/data/michelin.json";
import { getDistanceMeters } from "@/lib/matching";

type MichelinEntry = {
  name: string;
  award: MichelinAward;
  green_star: boolean;
  lat: number;
  lng: number;
};

type MichelinCityIndex = {
  cities: Record<string, MichelinEntry[]>;
};

type MichelinRawEntry = {
  name?: unknown;
  award?: unknown;
  green_star?: unknown;
  lat?: unknown;
  lng?: unknown;
};

const MICHELIN_DISTANCE_THRESHOLD_METERS = 80;

function getEmptyMichelinMatch(): MichelinMatch {
  return {
    award: EMPTY_MICHELIN_MATCH.award,
    green_star: EMPTY_MICHELIN_MATCH.green_star,
    matched: EMPTY_MICHELIN_MATCH.matched,
  };
}

function normalizeCityKey(city: string) {
  return city
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isMichelinAward(value: unknown): value is MichelinAward {
  return value === "1 Star" || value === "2 Stars" || value === "3 Stars" || value === "Bib Gourmand";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isMichelinRawEntry(value: unknown): value is MichelinRawEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as MichelinRawEntry;
  return (
    typeof entry.name === "string" &&
    isMichelinAward(entry.award) &&
    typeof entry.green_star === "boolean" &&
    isFiniteNumber(entry.lat) &&
    isFiniteNumber(entry.lng)
  );
}

function parseMichelinData(raw: unknown): MichelinCityIndex {
  if (!raw || typeof raw !== "object") {
    return { cities: {} };
  }

  const source =
    "cities" in (raw as Record<string, unknown>) &&
    (raw as Record<string, unknown>).cities &&
    typeof (raw as Record<string, unknown>).cities === "object"
      ? ((raw as Record<string, unknown>).cities as Record<string, unknown>)
      : (raw as Record<string, unknown>);

  const cities: Record<string, MichelinEntry[]> = {};

  for (const [cityKey, entries] of Object.entries(source)) {
    if (!Array.isArray(entries)) continue;

    const normalizedEntries: MichelinEntry[] = entries
      .filter(isMichelinRawEntry)
      .map((entry) => ({
        name: entry.name as string,
        award: entry.award as MichelinAward,
        green_star: entry.green_star as boolean,
        lat: entry.lat as number,
        lng: entry.lng as number,
      }));

    if (normalizedEntries.length > 0) {
      cities[normalizeCityKey(cityKey)] = normalizedEntries;
    }
  }

  return { cities };
}

const parsedMichelinData = parseMichelinData(michelinData);

export function getMichelinEntriesForCity(city: string): MichelinEntry[] {
  return parsedMichelinData.cities[normalizeCityKey(city)] ?? [];
}

export function resolveMichelinMatch(
  coordinates: { lat: number; lng: number },
  entries: MichelinEntry[],
): MichelinMatch {
  if (entries.length === 0) return getEmptyMichelinMatch();

  let nearestEntry: MichelinEntry | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const entry of entries) {
    const distance = getDistanceMeters(coordinates, { lat: entry.lat, lng: entry.lng });
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestEntry = entry;
    }
  }

  if (!nearestEntry || nearestDistance >= MICHELIN_DISTANCE_THRESHOLD_METERS) {
    return getEmptyMichelinMatch();
  }

  return {
    award: nearestEntry.award,
    green_star: nearestEntry.green_star,
    matched: true,
  };
}

export function matchMichelinForRestaurant(input: {
  city: string;
  lat: number;
  lng: number;
}): MichelinMatch {
  const entries = getMichelinEntriesForCity(input.city);
  return resolveMichelinMatch({ lat: input.lat, lng: input.lng }, entries);
}
