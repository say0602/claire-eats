import { useMemo, useState } from "react";

type SearchBarProps = {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  isLoading?: boolean;
};

const CITY_SUGGESTIONS = [
  "San Francisco, CA",
  "San Diego, CA",
  "San Jose, CA",
  "Los Angeles, CA",
  "New York, NY",
  "Chicago, IL",
  "Seattle, WA",
  "Austin, TX",
  "Miami, FL",
  "London, UK",
  "Paris, France",
  "Tokyo, Japan",
];

export function SearchBar({
  value,
  onValueChange,
  onSubmit,
  disabled = false,
  isLoading = false,
}: SearchBarProps) {
  const isSubmitDisabled = disabled || isLoading || value.trim().length === 0;
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const filteredSuggestions = useMemo(() => {
    const query = value.trim().toLowerCase();
    const base = query.length === 0 ? CITY_SUGGESTIONS : CITY_SUGGESTIONS.filter((city) => city.toLowerCase().includes(query));
    return base.slice(0, 8);
  }, [value]);

  const shouldShowSuggestions =
    !disabled && !isLoading && isDropdownOpen && filteredSuggestions.length > 0;

  return (
    <form
      className="w-full rounded border border-zinc-200 bg-white p-4"
      aria-label="Search restaurants form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!isSubmitDisabled) {
          onSubmit();
        }
      }}
    >
      <label htmlFor="city" className="mb-2 block text-sm font-medium">
        City
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative w-full">
          <input
            id="city"
            name="city"
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            onFocus={() => setIsDropdownOpen(true)}
            onBlur={() => {
              // Delay close so suggestion clicks can register.
              setTimeout(() => setIsDropdownOpen(false), 100);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setIsDropdownOpen(false);
              }
            }}
            autoComplete="off"
            disabled={disabled || isLoading}
            className="w-full rounded border border-zinc-300 px-3 py-2"
            placeholder="Enter a city (e.g., San Francisco, CA)"
            aria-controls="city-suggestions"
            aria-autocomplete="list"
          />
          {shouldShowSuggestions && (
            <ul
              id="city-suggestions"
              role="listbox"
              className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded border border-zinc-200 bg-white py-1 shadow-lg"
            >
              {filteredSuggestions.map((city) => (
                <li key={city} role="option" aria-selected={false}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      onValueChange(city);
                      setIsDropdownOpen(false);
                    }}
                  >
                    {city}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="submit"
          className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-500"
          disabled={isSubmitDisabled}
        >
          {isLoading ? "Searching..." : "Search"}
        </button>
      </div>
    </form>
  );
}
