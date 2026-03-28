type SearchBarProps = {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  isLoading?: boolean;
};

export function SearchBar({
  value,
  onValueChange,
  onSubmit,
  disabled = false,
  isLoading = false,
}: SearchBarProps) {
  const isSubmitDisabled = disabled || isLoading || value.trim().length === 0;

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
        <input
          id="city"
          name="city"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          disabled={disabled || isLoading}
          className="w-full rounded border border-zinc-300 px-3 py-2"
          placeholder="Enter a city"
        />
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
