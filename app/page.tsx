 "use client";

import { useState } from "react";
import { RestaurantTable } from "@/components/RestaurantTable";
import type { SortKey } from "@/components/RestaurantTable";
import { SearchBar } from "@/components/SearchBar";
import type { Restaurant, SearchWarning } from "@/lib/types";

function isSearchWarning(value: unknown): value is SearchWarning {
  if (!value || typeof value !== "object") return false;
  const warning = value as Record<string, unknown>;
  return typeof warning.code === "string" && typeof warning.message === "string";
}

function isRestaurantArray(value: unknown): value is Restaurant[] {
  if (!Array.isArray(value)) return false;

  return value.every((restaurant) => {
    if (!restaurant || typeof restaurant !== "object") return false;

    const record = restaurant as Record<string, unknown>;
    const yelp = record.yelp as Record<string, unknown> | undefined;
    const google = record.google as Record<string, unknown> | undefined;

    return (
      typeof record.id === "string" &&
      typeof record.name === "string" &&
      typeof record.city === "string" &&
      !!yelp &&
      typeof yelp.review_count === "number" &&
      typeof yelp.rating === "number" &&
      !!google &&
      ("review_count" in google) &&
      ("rating" in google) &&
      ("maps_url" in google)
    );
  });
}

function isSearchSuccessPayload(value: unknown): value is { city: string; restaurants: Restaurant[]; warnings: SearchWarning[] } {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.city === "string" &&
    isRestaurantArray(payload.restaurants) &&
    Array.isArray(payload.warnings) &&
    payload.warnings.every(isSearchWarning)
  );
}

function hasErrorPayload(value: unknown): value is { error: { message?: string } } {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  if (!payload.error || typeof payload.error !== "object") return false;
  return true;
}

export default function Home() {
  const [city, setCity] = useState("");
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [warnings, setWarnings] = useState<SearchWarning[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("combined_score");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchedCity, setSearchedCity] = useState<string | null>(null);

  async function handleSearch() {
    const trimmedCity = city.trim();
    if (!trimmedCity) return;

    setIsLoading(true);
    setErrorMessage(null);
    setWarnings([]);

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city: trimmedCity }),
      });

      const payload: unknown = await response.json();
      if (!response.ok || hasErrorPayload(payload)) {
        setRestaurants([]);
        setSearchedCity(trimmedCity);
        const errorMessage =
          hasErrorPayload(payload) && typeof payload.error.message === "string"
            ? payload.error.message
            : "Search failed.";
        setErrorMessage(errorMessage);
        return;
      }

      if (!isSearchSuccessPayload(payload)) {
        setRestaurants([]);
        setSearchedCity(trimmedCity);
        setErrorMessage("Search response format is invalid.");
        return;
      }

      setRestaurants(payload.restaurants);
      setWarnings(payload.warnings);
      setSearchedCity(payload.city || trimmedCity);
      setSortKey("combined_score");
    } catch {
      setRestaurants([]);
      setSearchedCity(trimmedCity);
      setErrorMessage("Unable to complete search. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 bg-zinc-50 px-6 py-8 font-sans">
      <main className="flex flex-col gap-4">
        <header>
          <h1 className="text-2xl font-semibold text-zinc-900">Claire Eats</h1>
          <p className="mt-1 text-sm text-zinc-600">Research restaurants by city — Yelp and Google in one view.</p>
        </header>
        <SearchBar
          value={city}
          onValueChange={setCity}
          onSubmit={handleSearch}
          isLoading={isLoading}
        />

        {warnings.length > 0 && (
          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">Partial enrichment warnings</p>
            <ul className="mt-1 list-disc pl-5">
              {warnings.map((warning) => (
                <li key={warning.code}>{warning.message}</li>
              ))}
            </ul>
          </div>
        )}

        {errorMessage && (
          <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <p className="font-medium">Search failed</p>
            <p>{errorMessage}</p>
          </div>
        )}

        {!errorMessage && !isLoading && searchedCity && restaurants.length === 0 && (
          <div className="rounded border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
            No Yelp restaurants found for {searchedCity}.
          </div>
        )}

        {isLoading && (
          <div className="rounded border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
            Loading restaurants...
          </div>
        )}

        {!isLoading && restaurants.length > 0 && (
          <RestaurantTable restaurants={restaurants} sortKey={sortKey} onSortKeyChange={setSortKey} />
        )}
      </main>
    </div>
  );
}
