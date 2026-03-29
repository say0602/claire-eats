import { useMemo, useState } from "react";

type SearchBarProps = {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  isLoading?: boolean;
  suggestions?: string[];
};

const DEFAULT_CITY_SUGGESTIONS = [
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
  suggestions = DEFAULT_CITY_SUGGESTIONS,
}: SearchBarProps) {
  const isSubmitDisabled = disabled || isLoading || value.trim().length === 0;
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const filteredSuggestions = useMemo(() => {
    const query = value.trim().toLowerCase();
    const normalizedSuggestions = Array.from(
      new Map(
        (suggestions ?? [])
          .map((city) => city.trim())
          .filter((city) => city.length > 0)
          .map((city) => [city.toLowerCase(), city]),
      ).values(),
    );
    const base = query.length === 0
      ? normalizedSuggestions
      : normalizedSuggestions.filter((city) => city.toLowerCase().includes(query));
    return base.slice(0, 8);
  }, [value, suggestions]);

  const shouldShowSuggestions =
    !disabled && !isLoading && isDropdownOpen && filteredSuggestions.length > 0;

  return (
    <form
      className="w-full"
      aria-label="Search restaurants form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!isSubmitDisabled) {
          onSubmit();
        }
      }}
    >
      <label htmlFor="city" className="mb-2 block text-sm font-medium text-[#8A7060]">
        City
      </label>
      <div className="flex items-stretch">
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
            className="h-11 w-full rounded-l-xl rounded-r-none border border-[#E8DAD0] bg-white px-4 text-base text-[#2C1810] placeholder:text-[#8A7060] focus:outline-none focus:ring-2 focus:ring-[#C4342D]/20 sm:h-12 sm:px-5 sm:text-[18px]"
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
          className="h-11 rounded-r-xl rounded-l-none bg-[#C4342D] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#AD2E29] disabled:cursor-not-allowed disabled:bg-[#C4342D]/70 sm:h-12 sm:px-8 sm:text-base"
          disabled={isSubmitDisabled}
        >
          <span className="inline-flex items-center gap-2">
            {isLoading ? (
              <span
                aria-hidden="true"
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/60 border-t-white"
              />
            ) : null}
            <span>{isLoading ? "Searching..." : "Search"}</span>
          </span>
        </button>
      </div>
    </form>
  );
}
