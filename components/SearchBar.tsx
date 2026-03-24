type SearchBarProps = {
  disabled?: boolean;
};

export function SearchBar({ disabled = false }: SearchBarProps) {
  return (
    <form className="w-full rounded border border-zinc-200 p-4" aria-label="Search restaurants form">
      <label htmlFor="city" className="mb-2 block text-sm font-medium">
        City
      </label>
      <input
        id="city"
        name="city"
        disabled={disabled}
        className="w-full rounded border border-zinc-300 px-3 py-2"
        placeholder="Enter a city"
      />
    </form>
  );
}
