import { useMemo } from "react";
import type { Restaurant } from "@/lib/types";
import { ScorePill } from "@/components/ScorePill";
import type { AppProfile } from "@/lib/app-profile";

export type SortKey = "combined_score" | "total_reviews" | "yelp_reviews" | "yelp_rating" | "google_rating" | "google_reviews";

type RestaurantTableProps = {
  restaurants: Restaurant[];
  sortKey: SortKey;
  onSortKeyChange: (key: SortKey) => void;
  isGoogleOnly?: boolean;
  appProfile?: AppProfile;
  downloadFilename?: string;
  onMapOpen?: (payload: { restaurantId: string; city: string; rank: number }) => void;
};

export function formatReviewCount(count: number | null) {
  if (count === null) return "-";
  if (count < 1000) return new Intl.NumberFormat("en-US").format(count);
  return `${(count / 1000).toFixed(1)}k`;
}

function formatRating(rating: number | null) {
  if (rating === null) return "-";
  return rating.toFixed(1);
}

function formatCuisine(categories: string[]) {
  if (categories.length === 0) return "-";
  return categories.join(", ");
}

function nullSafeDescending(a: number | null, b: number | null) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

function totalReviews(restaurant: Restaurant) {
  return restaurant.yelp.review_count + (restaurant.google.review_count ?? 0);
}

function escapeCsvValue(value: string) {
  if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}

function toCsvCell(value: number | string | null) {
  if (value === null) return "-";
  return escapeCsvValue(String(value));
}

export function buildRestaurantsCsv(restaurants: Restaurant[], isGoogleOnly = false) {
  const rows = restaurants.map((restaurant, index) => {
    const yelpMissing = isGoogleOnly || restaurant.yelp.review_count === 0;
    return [
      index + 1,
      restaurant.name,
      restaurant.combined_score === null ? "-" : restaurant.combined_score.toFixed(1),
      totalReviews(restaurant),
      yelpMissing ? "-" : restaurant.yelp.rating.toFixed(1),
      yelpMissing ? "-" : restaurant.yelp.review_count,
      restaurant.google.rating === null ? "-" : restaurant.google.rating.toFixed(1),
      restaurant.google.review_count ?? "-",
      yelpMissing ? "-" : (restaurant.yelp.price ?? "-"),
      restaurant.yelp.categories.length > 0 ? restaurant.yelp.categories.join(", ") : "-",
      restaurant.city,
      restaurant.google.maps_url ?? "-",
    ]
      .map(toCsvCell)
      .join(",");
  });

  const header = [
    "Rank",
    "Restaurant",
    "Score",
    "Total Reviews",
    "Yelp Rating",
    "Yelp Reviews",
    "Google Rating",
    "Google Reviews",
    "Price",
    "Cuisine",
    "City",
    "Google Maps URL",
  ].join(",");

  return [header, ...rows].join("\n");
}

export function getSortedRestaurants(restaurants: Restaurant[], sortKey: SortKey) {
  const sorted = [...restaurants];
  sorted.sort((a, b) => {
    switch (sortKey) {
      case "combined_score":
        return nullSafeDescending(a.combined_score, b.combined_score);
      case "total_reviews":
        return totalReviews(b) - totalReviews(a);
      case "yelp_reviews":
        return b.yelp.review_count - a.yelp.review_count;
      case "yelp_rating":
        return b.yelp.rating - a.yelp.rating;
      case "google_rating":
        return nullSafeDescending(a.google.rating, b.google.rating);
      case "google_reviews":
        return nullSafeDescending(a.google.review_count, b.google.review_count);
      default:
        return 0;
    }
  });
  return sorted;
}

function SortIcon({ active, disabled }: { active: boolean; disabled: boolean }) {
  const fill = disabled ? "#d4d4d8" : active ? "#18181b" : "#a1a1aa";

  return (
    <svg width="8" height="6" viewBox="0 0 8 6" fill="none" aria-hidden="true" className="shrink-0">
      <path d="M4 6L0 0H8L4 6Z" fill={fill} />
    </svg>
  );
}

function SortButton({
  label,
  tooltipDescription,
  active,
  onClick,
  disabled = false,
}: {
  label: string;
  tooltipDescription?: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`inline-flex items-center gap-1 text-left ${disabled ? "cursor-default text-zinc-400" : active ? "font-semibold text-zinc-900" : "text-zinc-700"}`}
      onClick={onClick}
    >
      {tooltipDescription ? (
        <span className="group relative inline-flex items-center">
          <span
            className="cursor-help border-b border-dotted border-zinc-300"
            aria-describedby={`hint-${label.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {label}
          </span>
          <span
            id={`hint-${label.toLowerCase().replace(/\s+/g, "-")}`}
            role="tooltip"
            className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 w-56 -translate-x-1/2 rounded border border-zinc-200 bg-white px-2 py-1 text-[11px] font-normal leading-relaxed text-zinc-700 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          >
            {tooltipDescription}
          </span>
        </span>
      ) : (
        <span>{label}</span>
      )}
      <SortIcon active={active} disabled={disabled} />
    </button>
  );
}

export function RestaurantTable({
  restaurants,
  sortKey,
  onSortKeyChange,
  isGoogleOnly = false,
  appProfile = "private",
  downloadFilename = "claire-eats-results.csv",
  onMapOpen,
}: RestaurantTableProps) {
  const isPublicProfile = appProfile === "public";
  const effectiveSortKey: SortKey =
    isPublicProfile && sortKey === "combined_score" ? "total_reviews" : sortKey;
  const sortedRestaurants = useMemo(
    () => getSortedRestaurants(restaurants, effectiveSortKey),
    [restaurants, effectiveSortKey],
  );
  const csvHref = useMemo(() => {
    if (isPublicProfile) return "";
    const csvContent = buildRestaurantsCsv(sortedRestaurants, isGoogleOnly);
    // Include UTF-8 BOM for better Excel compatibility.
    return `data:text/csv;charset=utf-8,${encodeURIComponent(`\uFEFF${csvContent}`)}`;
  }, [sortedRestaurants, isGoogleOnly, isPublicProfile]);

  const showYelpPlaceholder = (restaurant: Restaurant) => isGoogleOnly || restaurant.yelp.review_count === 0;
  return (
    <div className="w-full rounded border border-zinc-200 bg-white p-4">
      {!isPublicProfile && (
        <div className="mb-3 flex justify-end">
          <a
            href={csvHref}
            download={downloadFilename}
            className="inline-flex items-center rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Download CSV
          </a>
        </div>
      )}
      <div>
        <table className="w-full table-fixed border-collapse text-xs sm:text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-zinc-600">
              <th className="w-20 px-1.5 py-2">
                {isPublicProfile ? (
                  <SortButton
                    label="Popularity Rank"
                    active={effectiveSortKey === "total_reviews"}
                    onClick={() => onSortKeyChange("total_reviews")}
                  />
                ) : (
                  "#"
                )}
              </th>
              <th className="w-[25%] px-1.5 py-2">Restaurant</th>
              {!isPublicProfile && (
                <th className="w-16 px-1.5 py-2">
                  <SortButton
                    label="Score"
                    tooltipDescription="Weighted average of Yelp and Google ratings (scaled to 10). Each source's weight is its review count — more reviews = more influence."
                    active={effectiveSortKey === "combined_score"}
                    onClick={() => onSortKeyChange("combined_score")}
                  />
                </th>
              )}
              {!isPublicProfile && (
                <th className="w-20 px-1.5 py-2">
                  <SortButton
                    label="Total Reviews"
                    tooltipDescription="Yelp review count plus Google review count."
                    active={effectiveSortKey === "total_reviews"}
                    onClick={() => onSortKeyChange("total_reviews")}
                  />
                </th>
              )}
              <th className="w-16 px-1.5 py-2">
                <SortButton
                  label="Yelp Rating"
                  active={effectiveSortKey === "yelp_rating"}
                  onClick={() => onSortKeyChange("yelp_rating")}
                  disabled={isGoogleOnly || isPublicProfile}
                />
              </th>
              <th className="w-20 px-1.5 py-2">
                <SortButton
                  label="Yelp Reviews"
                  active={effectiveSortKey === "yelp_reviews"}
                  onClick={() => onSortKeyChange("yelp_reviews")}
                  disabled={isGoogleOnly || isPublicProfile}
                />
              </th>
              <th className="w-16 px-1.5 py-2">
                <SortButton
                  label="Google Rating"
                  active={effectiveSortKey === "google_rating"}
                  onClick={() => onSortKeyChange("google_rating")}
                  disabled={isPublicProfile}
                />
              </th>
              <th className="w-24 px-1.5 py-2">
                <SortButton
                  label="Google Reviews"
                  active={effectiveSortKey === "google_reviews"}
                  onClick={() => onSortKeyChange("google_reviews")}
                  disabled={isPublicProfile}
                />
              </th>
              <th className="w-14 px-1.5 py-2">Price</th>
              <th className="w-[20%] px-1.5 py-2">Cuisine</th>
              <th className="w-12 px-1.5 py-2">Map</th>
            </tr>
          </thead>
          <tbody>
            {sortedRestaurants.map((restaurant, index) => (
              <tr key={restaurant.id} className="border-b border-zinc-100 align-top">
                <td className="px-1.5 py-2 text-zinc-500">{index + 1}</td>
                <td className="px-1.5 py-2 font-medium text-zinc-900">{restaurant.name}</td>
                {!isPublicProfile && (
                  <td className="px-1.5 py-2">
                    <ScorePill score={restaurant.combined_score} />
                  </td>
                )}
                {!isPublicProfile && (
                  <td className="px-1.5 py-2">{formatReviewCount(totalReviews(restaurant))}</td>
                )}
                <td className="px-1.5 py-2">{showYelpPlaceholder(restaurant) ? "-" : formatRating(restaurant.yelp.rating)}</td>
                <td className="px-1.5 py-2">{showYelpPlaceholder(restaurant) ? "-" : formatReviewCount(restaurant.yelp.review_count)}</td>
                <td className="px-1.5 py-2">{formatRating(restaurant.google.rating)}</td>
                <td className="px-1.5 py-2">{formatReviewCount(restaurant.google.review_count)}</td>
                <td className="px-1.5 py-2">{showYelpPlaceholder(restaurant) ? "-" : (restaurant.yelp.price ?? "-")}</td>
                <td className="px-1.5 py-2">{formatCuisine(restaurant.yelp.categories)}</td>
                <td className="px-1.5 py-2">
                  {restaurant.google.maps_url ? (
                    <a
                      href={restaurant.google.maps_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex rounded border border-zinc-300 px-1.5 py-0.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                      onClick={() =>
                        onMapOpen?.({
                          restaurantId: restaurant.id,
                          city: restaurant.city,
                          rank: index + 1,
                        })
                      }
                    >
                      Open
                    </a>
                  ) : (
                    <span className="text-zinc-400">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
