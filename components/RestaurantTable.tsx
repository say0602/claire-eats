import type { Restaurant } from "@/lib/types";

export type SortKey = "yelp_reviews" | "yelp_rating";

type RestaurantTableProps = {
  restaurants: Restaurant[];
  sortKey: SortKey;
  onSortKeyChange: (key: SortKey) => void;
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

export function getSortedRestaurants(restaurants: Restaurant[], sortKey: SortKey) {
  const sorted = [...restaurants];
  sorted.sort((a, b) => {
    if (sortKey === "yelp_reviews") {
      return b.yelp.review_count - a.yelp.review_count;
    }

    return b.yelp.rating - a.yelp.rating;
  });
  return sorted;
}

function SortButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`text-left ${active ? "font-semibold text-zinc-900" : "text-zinc-700"}`}
      onClick={onClick}
    >
      {label}
      {active ? " ↓" : ""}
    </button>
  );
}

export function RestaurantTable({ restaurants, sortKey, onSortKeyChange }: RestaurantTableProps) {
  const sortedRestaurants = getSortedRestaurants(restaurants, sortKey);

  return (
    <div className="w-full rounded border border-zinc-200 bg-white p-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-zinc-600">
              <th className="px-2 py-2">#</th>
              <th className="px-2 py-2">Restaurant</th>
              <th className="px-2 py-2">
                <SortButton
                  label="Yelp Rating"
                  active={sortKey === "yelp_rating"}
                  onClick={() => onSortKeyChange("yelp_rating")}
                />
              </th>
              <th className="px-2 py-2">
                <SortButton
                  label="Yelp Reviews"
                  active={sortKey === "yelp_reviews"}
                  onClick={() => onSortKeyChange("yelp_reviews")}
                />
              </th>
              <th className="px-2 py-2">Google Rating</th>
              <th className="px-2 py-2">Google Reviews</th>
              <th className="px-2 py-2">Price</th>
              <th className="px-2 py-2">Cuisine</th>
              <th className="px-2 py-2">Map</th>
            </tr>
          </thead>
          <tbody>
            {sortedRestaurants.map((restaurant, index) => (
              <tr key={restaurant.id} className="border-b border-zinc-100 align-top">
                <td className="px-2 py-3 text-zinc-500">{index + 1}</td>
                <td className="px-2 py-3 font-medium text-zinc-900">{restaurant.name}</td>
                <td className="px-2 py-3">{formatRating(restaurant.yelp.rating)}</td>
                <td className="px-2 py-3">{formatReviewCount(restaurant.yelp.review_count)}</td>
                <td className="px-2 py-3">{formatRating(restaurant.google.rating)}</td>
                <td className="px-2 py-3">{formatReviewCount(restaurant.google.review_count)}</td>
                <td className="px-2 py-3">{restaurant.yelp.price ?? "-"}</td>
                <td className="px-2 py-3">{formatCuisine(restaurant.yelp.categories)}</td>
                <td className="px-2 py-3">
                  {restaurant.google.maps_url ? (
                    <a
                      href={restaurant.google.maps_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
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
