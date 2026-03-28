import { NextResponse } from "next/server";
import { EnvValidationError, getServerEnv } from "@/lib/env";
import type { YelpPriceTier } from "@/lib/types";

const YELP_SEARCH_URL = "https://api.yelp.com/v3/businesses/search";
const YELP_RESULT_LIMIT = 50;
const YELP_TIMEOUT_MS = 4000;

type YelpBusiness = {
  id: string;
  name: string;
  rating: number;
  review_count: number;
  price?: string;
  categories?: Array<{ title?: string }>;
  coordinates?: { latitude?: number; longitude?: number };
  location?: {
    address1?: string;
    address2?: string;
    address3?: string;
    zip_code?: string;
    display_address?: string[];
  };
};

type YelpApiResponse = {
  businesses?: YelpBusiness[];
};

type YelpRestaurantSeed = {
  id: string;
  name: string;
  city: string;
  yelp: {
    rating: number;
    review_count: number;
    price: YelpPriceTier | null;
    categories: string[];
    lat: number;
    lng: number;
    address?: string | null;
    postal_code?: string | null;
  };
};

function toYelpPriceTier(value: string | undefined): YelpPriceTier | null {
  if (!value) return null;
  if (value === "$" || value === "$$" || value === "$$$" || value === "$$$$") return value;
  return null;
}

function withTimeout(ms: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId),
  };
}

function toSeed(city: string, business: YelpBusiness): YelpRestaurantSeed | null {
  if (!business.id || !business.name) return null;
  if (typeof business.rating !== "number" || typeof business.review_count !== "number") return null;

  const lat = business.coordinates?.latitude;
  const lng = business.coordinates?.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") return null;

  const displayAddress = business.location?.display_address
    ?.map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(", ");
  const streetAddress = [business.location?.address1, business.location?.address2, business.location?.address3]
    .filter((line): line is string => typeof line === "string" && line.trim().length > 0)
    .map((line) => line.trim())
    .join(" ");
  const address = displayAddress || streetAddress || null;
  const postalCode =
    typeof business.location?.zip_code === "string" && business.location.zip_code.trim().length > 0
      ? business.location.zip_code.trim()
      : null;

  return {
    id: business.id,
    name: business.name,
    city,
    yelp: {
      rating: business.rating,
      review_count: business.review_count,
      price: toYelpPriceTier(business.price),
      categories: (business.categories ?? [])
        .map((category) => category.title?.trim())
        .filter((title): title is string => Boolean(title)),
      lat,
      lng,
      address,
      postal_code: postalCode,
    },
  };
}

export async function POST(request: Request) {
  let city = "";

  try {
    const body = await request.json();
    city = typeof body?.city === "string" ? body.city.trim() : "";
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Request body must be valid JSON." } },
      { status: 400 },
    );
  }

  if (!city) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Field `city` is required." } },
      { status: 400 },
    );
  }

  let yelpApiKey = "";
  try {
    yelpApiKey = getServerEnv().YELP_API_KEY;
  } catch (error) {
    if (error instanceof EnvValidationError) {
      return NextResponse.json(
        { error: { code: "CONFIG_ERROR", message: error.message } },
        { status: 500 },
      );
    }
    throw error;
  }

  const searchUrl = new URL(YELP_SEARCH_URL);
  searchUrl.searchParams.set("location", city);
  // Yelp category filter is too strict (e.g. excludes bakery-heavy "restaurant" results like Porto's).
  // Using term=restaurants better mirrors Yelp.com "Restaurants" search behavior.
  searchUrl.searchParams.set("term", "restaurants");
  searchUrl.searchParams.set("limit", String(YELP_RESULT_LIMIT));
  searchUrl.searchParams.set("sort_by", "review_count");

  const timeout = withTimeout(YELP_TIMEOUT_MS);
  try {
    const response = await fetch(searchUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${yelpApiKey}`,
        Accept: "application/json",
      },
      signal: timeout.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      const errorCode = response.status === 429 ? "YELP_RATE_LIMITED" : "YELP_UPSTREAM_ERROR";
      const status = response.status === 429 ? 429 : 502;
      return NextResponse.json(
        { error: { code: errorCode, message: `Yelp request failed with status ${response.status}.` } },
        { status },
      );
    }

    const payload = (await response.json()) as YelpApiResponse;
    const seeds = (payload.businesses ?? [])
      .map((business) => toSeed(city, business))
      .filter((value): value is YelpRestaurantSeed => value !== null);

    const dedupedSeeds = Array.from(new Map(seeds.map((seed) => [seed.id, seed])).values())
      .sort((a, b) => b.yelp.review_count - a.yelp.review_count)
      .slice(0, YELP_RESULT_LIMIT);

    return NextResponse.json({ city, restaurants: dedupedSeeds });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        { error: { code: "YELP_TIMEOUT", message: "Yelp request timed out." } },
        { status: 504 },
      );
    }

    return NextResponse.json(
      { error: { code: "YELP_UPSTREAM_ERROR", message: "Yelp request failed." } },
      { status: 502 },
    );
  } finally {
    timeout.clear();
  }
}
