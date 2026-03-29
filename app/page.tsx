 "use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RestaurantTable } from "@/components/RestaurantTable";
import type { SortKey } from "@/components/RestaurantTable";
import { SearchBar } from "@/components/SearchBar";
import { CityCards } from "@/components/CityCards";
import { getAppProfile } from "@/lib/app-profile";
import {
  buildMapOpenClickedEvent,
  buildResultsViewClosedEvent,
  buildSearchSubmittedEvent,
  createSessionId,
  emitAnalyticsEvent,
} from "@/lib/analytics";
import type { Restaurant, SearchWarning } from "@/lib/types";

const SNAPSHOT_VERSION_DEFAULT = "pilot-v1";

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

function isSearchSuccessPayload(value: unknown): value is { city: string; restaurants: Restaurant[]; warnings: SearchWarning[]; google_only?: boolean } {
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
  const appProfile = getAppProfile();
  const isPublicProfile = appProfile === "public";
  const [city, setCity] = useState("");
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [warnings, setWarnings] = useState<SearchWarning[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("total_reviews");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchedCity, setSearchedCity] = useState<string | null>(null);
  const [isGoogleOnly, setIsGoogleOnly] = useState(false);
  const [snapshotCities, setSnapshotCities] = useState<string[] | null>(null);
  const [snapshotFinishedAtUtc, setSnapshotFinishedAtUtc] = useState<string | null>(null);
  const sessionIdRef = useRef<string>(createSessionId());
  const activeResultsRef = useRef<{ city: string; openedAtMs: number } | null>(null);
  const latestSearchIdRef = useRef(0);

  const closeResultsView = useCallback(() => {
    const activeResults = activeResultsRef.current;
    if (!activeResults) return;

    const dwellMs = Math.max(0, Date.now() - activeResults.openedAtMs);
    void emitAnalyticsEvent(
      buildResultsViewClosedEvent({
        city: activeResults.city,
        dwellMs,
        sessionId: sessionIdRef.current,
      }),
    );
    activeResultsRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      closeResultsView();
    };
  }, [closeResultsView]);

  useEffect(() => {
    if (!isPublicProfile) {
      setSnapshotCities(null);
      setSnapshotFinishedAtUtc(null);
      return;
    }

    let cancelled = false;
    (async () => {
      const applySnapshotMeta = (record: Record<string, unknown>) => {
        const cities = record.cities;
        if (!Array.isArray(cities)) return false;
        const finishedAtRaw = typeof record.finished_at_utc === "string" ? record.finished_at_utc : null;
        const list = cities
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean);
        if (cancelled) return true;
        setSnapshotCities(Array.from(new Map(list.map((c) => [c.toLowerCase(), c])).values()));
        setSnapshotFinishedAtUtc(finishedAtRaw);
        return true;
      };

      try {
        const response = await fetch("/api/snapshots", { cache: "no-store" });
        const payload: unknown = await response.json();
        if (response.ok && payload && typeof payload === "object") {
          const applied = applySnapshotMeta(payload as Record<string, unknown>);
          if (applied) return;
        }
      } catch {
        // Fall back to static summary fetch.
      }

      try {
        const response = await fetch(`/precompute/${SNAPSHOT_VERSION_DEFAULT}/_run-summary.json`, {
          cache: "no-store",
        });
        const payload: unknown = await response.json();
        if (!response.ok || !payload || typeof payload !== "object") return;
        const parsed = payload as {
          finished_at_utc?: unknown;
          results?: Array<{ city?: unknown; success?: unknown }>;
        };
        const results = Array.isArray(parsed.results) ? parsed.results : [];
        const cities = results
          .filter((entry) => entry && entry.success === true && typeof entry.city === "string")
          .map((entry) => (entry.city as string).trim())
          .filter(Boolean);
        const fallbackRecord: Record<string, unknown> = {
          finished_at_utc: typeof parsed.finished_at_utc === "string" ? parsed.finished_at_utc : null,
          cities,
        };
        applySnapshotMeta(fallbackRecord);
      } catch {
        // Ignore and fall back to default suggestions.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isPublicProfile]);

  const demoNote = useMemo(() => {
    if (!isPublicProfile) return null;
    let dateSuffix = "";
    if (snapshotFinishedAtUtc) {
      const timestampMs = Date.parse(snapshotFinishedAtUtc);
      if (Number.isFinite(timestampMs)) {
        dateSuffix = ` (updated ${new Date(timestampMs).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })})`;
      }
    }
    if (snapshotCities && snapshotCities.length > 0) {
      return `Demo mode: ${snapshotCities.length} top cities are precomputed for speed${dateSuffix}; other cities use live search.`;
    }
    return `Demo mode: top cities are precomputed for speed when available${dateSuffix}; other cities use live search.`;
  }, [isPublicProfile, snapshotCities, snapshotFinishedAtUtc]);

  async function executeSearch(targetCity: string) {
    const trimmedCity = targetCity.trim();
    if (!trimmedCity) return;
    const searchId = latestSearchIdRef.current + 1;
    latestSearchIdRef.current = searchId;

    closeResultsView();
    void emitAnalyticsEvent(buildSearchSubmittedEvent(trimmedCity, sessionIdRef.current));

    setIsLoading(true);
    setErrorMessage(null);
    setWarnings([]);
    setIsGoogleOnly(false);

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city: trimmedCity }),
      });

      const payload: unknown = await response.json();
      if (searchId !== latestSearchIdRef.current) return;

      if (!response.ok || hasErrorPayload(payload)) {
        setRestaurants([]);
        setSearchedCity(trimmedCity);
        activeResultsRef.current = null;
        const errorMessage =
          hasErrorPayload(payload) && typeof payload.error.message === "string"
            ? payload.error.message
            : "Search failed.";
        setErrorMessage(errorMessage);
        return;
      }

      if (!isSearchSuccessPayload(payload)) {
        if (searchId !== latestSearchIdRef.current) return;
        setRestaurants([]);
        setSearchedCity(trimmedCity);
        activeResultsRef.current = null;
        setErrorMessage("Search response format is invalid.");
        return;
      }

      setRestaurants(payload.restaurants);
      setWarnings(payload.warnings);
      setSearchedCity(payload.city || trimmedCity);
      setIsGoogleOnly(payload.google_only === true);
      setSortKey("total_reviews");
      activeResultsRef.current =
        payload.restaurants.length > 0
          ? {
              city: payload.city || trimmedCity,
              openedAtMs: Date.now(),
            }
          : null;
    } catch {
      if (searchId !== latestSearchIdRef.current) return;
      setRestaurants([]);
      setSearchedCity(trimmedCity);
      activeResultsRef.current = null;
      setErrorMessage("Unable to complete search. Please try again.");
    } finally {
      if (searchId === latestSearchIdRef.current) {
        setIsLoading(false);
      }
    }
  }

  function handleSearch() {
    executeSearch(city);
  }

  function handleCityCardSelect(selectedCity: string) {
    setCity(selectedCity);
    executeSearch(selectedCity);
  }

  const handleMapOpen = useCallback(
    ({ restaurantId, city: mapCity, rank }: { restaurantId: string; city: string; rank: number }) => {
      void emitAnalyticsEvent(
        buildMapOpenClickedEvent({
          restaurantId,
          city: mapCity,
          sortKey,
          rank,
          sessionId: sessionIdRef.current,
        }),
      );
    },
    [sortKey],
  );

  const downloadFilename = searchedCity
    ? `claire-eats-${searchedCity.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "results"}.csv`
    : "claire-eats-results.csv";

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 bg-zinc-50 px-6 py-8 font-sans">
      <main className="flex flex-col gap-4">
        <section className="relative rounded-2xl border-[0.5px] border-[#E8DAD0] bg-[#FBF5F0] p-10">
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
            <div className="absolute -right-10 -top-14 h-44 w-44 rounded-full bg-[#C4342D] opacity-[0.04]" />
            <div className="absolute right-10 top-10 h-20 w-20 rounded-full bg-[#C4342D] opacity-[0.06]" />
          </div>

          <header className="relative z-10 mb-6">
            <div className="mb-4 inline-flex items-center gap-2.5">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#C4342D]"
                aria-hidden="true"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-white">
                  <path
                    d="M7 3V11M5 3V7M9 3V7M7 11V21M16 3V9L14 11V21M19 3V21"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span className="text-[14px] font-semibold tracking-[0.08em] text-[#C4342D]">RESTAURANT RANKINGS</span>
            </div>
            <h1 className="text-[34px] font-medium leading-none text-[#2C1810]">Claire Eats</h1>
            <p className="mt-3 text-[14px] text-[#8A7060]">Research restaurants by city — Yelp and Google in one view.</p>
          </header>

          <div className="relative z-10 max-w-3xl">
            <SearchBar
              value={city}
              onValueChange={setCity}
              onSubmit={handleSearch}
              isLoading={isLoading}
              suggestions={isPublicProfile && snapshotCities ? snapshotCities : undefined}
            />
            {demoNote ? (
              <p className="mt-2 text-xs text-[#8A7060]">{demoNote}</p>
            ) : null}
          </div>
        </section>

        {isPublicProfile && !searchedCity && !isLoading && (
          <CityCards onCitySelect={handleCityCardSelect} />
        )}

        {isGoogleOnly && restaurants.length > 0 && (
          <div className="rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800" aria-live="polite">
            <p className="font-medium">Limited Yelp coverage</p>
            <p>Yelp has limited coverage for {searchedCity}. Showing Google-only results — Yelp ratings and review counts are not available.</p>
          </div>
        )}

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
            {isGoogleOnly
              ? `Neither Yelp nor Google returned results for ${searchedCity}.`
              : `No restaurants found for ${searchedCity}. Try a different city or check the spelling.`}
          </div>
        )}

        {isLoading && (
          <div className="rounded border border-zinc-200 bg-white p-4" role="status" aria-live="polite" aria-busy="true">
            <div className="mb-2 inline-flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-[#C4342D]"
              />
              <p className="text-sm font-medium text-zinc-700">Searching restaurants...</p>
            </div>
            <p className="mb-3 text-xs text-zinc-500">
              Matching Yelp and Google data can take longer while backfill runs.
            </p>
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <div className="h-4 w-8 animate-pulse rounded bg-zinc-100" />
                  <div className="h-4 flex-1 animate-pulse rounded bg-zinc-100" />
                  <div className="h-4 w-12 animate-pulse rounded bg-zinc-100" />
                  <div className="h-4 w-12 animate-pulse rounded bg-zinc-100" />
                </div>
              ))}
            </div>
          </div>
        )}

        {!isLoading && restaurants.length > 0 && (
          <RestaurantTable
            restaurants={restaurants}
            sortKey={sortKey}
            onSortKeyChange={setSortKey}
            isGoogleOnly={isGoogleOnly}
            downloadFilename={downloadFilename}
            appProfile={appProfile}
            onMapOpen={handleMapOpen}
          />
        )}
      </main>
    </div>
  );
}
