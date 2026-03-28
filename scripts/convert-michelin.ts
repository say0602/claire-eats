import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

type MichelinAward = "1 Star" | "2 Stars" | "3 Stars" | "Bib Gourmand";

type MichelinCityEntry = {
  name: string;
  award: MichelinAward;
  green_star: boolean;
  lat: number;
  lng: number;
};

type MichelinCityIndex = {
  cities: Record<string, MichelinCityEntry[]>;
};

type MichelinSourceRow = Record<string, unknown>;

const ALLOWED_AWARDS: MichelinAward[] = ["1 Star", "2 Stars", "3 Stars", "Bib Gourmand"];

function normalizeCityKey(city: string) {
  return city
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "y";
}

function normalizeAward(value: unknown): MichelinAward | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return ALLOWED_AWARDS.includes(trimmed as MichelinAward) ? (trimmed as MichelinAward) : null;
}

function getString(row: MichelinSourceRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function getNumber(row: MichelinSourceRow, keys: string[]) {
  for (const key of keys) {
    const parsed = parseNumber(row[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function getBoolean(row: MichelinSourceRow, keys: string[]) {
  for (const key of keys) {
    if (key in row) return parseBoolean(row[key]);
  }
  return false;
}

function isMichelinSourceRow(value: unknown): value is MichelinSourceRow {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function validateMichelinCityIndex(value: unknown): value is MichelinCityIndex {
  if (!value || typeof value !== "object") return false;
  const citiesContainer = (value as Record<string, unknown>).cities;
  if (!citiesContainer || typeof citiesContainer !== "object") return false;

  for (const entries of Object.values(citiesContainer as Record<string, unknown>)) {
    if (!Array.isArray(entries)) return false;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") return false;
      const row = entry as Record<string, unknown>;
      if (typeof row.name !== "string") return false;
      if (!ALLOWED_AWARDS.includes(row.award as MichelinAward)) return false;
      if (typeof row.green_star !== "boolean") return false;
      if (typeof row.lat !== "number" || !Number.isFinite(row.lat)) return false;
      if (typeof row.lng !== "number" || !Number.isFinite(row.lng)) return false;
    }
  }

  return true;
}

export function convertMichelinData(sourceRows: unknown[]): MichelinCityIndex {
  const cities: Record<string, MichelinCityEntry[]> = {};

  for (const sourceRow of sourceRows) {
    if (!isMichelinSourceRow(sourceRow)) continue;

    const name = getString(sourceRow, ["Name", "name", "Restaurant", "restaurant"]);
    const city = getString(sourceRow, ["City", "city"]);
    const award = normalizeAward(sourceRow.Award ?? sourceRow.award);
    const lat = getNumber(sourceRow, ["Latitude", "latitude", "lat"]);
    const lng = getNumber(sourceRow, ["Longitude", "longitude", "lng"]);
    const greenStar = getBoolean(sourceRow, ["GreenStar", "green_star", "greenStar"]);

    if (!name || !city || !award || lat === null || lng === null) continue;

    const cityKey = normalizeCityKey(city);
    if (!cities[cityKey]) cities[cityKey] = [];
    cities[cityKey].push({
      name,
      award,
      green_star: greenStar,
      lat,
      lng,
    });
  }

  const converted: MichelinCityIndex = { cities };
  if (!validateMichelinCityIndex(converted)) {
    throw new Error("Converted Michelin output failed schema validation.");
  }

  return converted;
}

async function runCli() {
  const defaultInputPath = path.resolve(process.cwd(), "data/michelin-source.json");
  const defaultOutputPath = path.resolve(process.cwd(), "data/michelin.json");
  const inputPath = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : defaultInputPath;
  const outputPath = process.argv[3] ? path.resolve(process.cwd(), process.argv[3]) : defaultOutputPath;

  const sourceContent = await readFile(inputPath, "utf-8");
  const raw = JSON.parse(sourceContent) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error("Expected source Michelin data to be a JSON array.");
  }

  const converted = convertMichelinData(raw);
  await writeFile(outputPath, `${JSON.stringify(converted, null, 2)}\n`, "utf-8");

  const cityCount = Object.keys(converted.cities).length;
  const rowCount = Object.values(converted.cities).reduce((count, rows) => count + rows.length, 0);
  console.log(`Converted Michelin dataset: ${rowCount} rows across ${cityCount} cities.`);
}

const entryArg = process.argv[1];
const isCliEntry = entryArg ? import.meta.url === pathToFileURL(entryArg).href : false;

if (isCliEntry) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown conversion error";
    console.error(`Michelin conversion failed: ${message}`);
    process.exitCode = 1;
  });
}
