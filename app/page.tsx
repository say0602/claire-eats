import { RestaurantTable } from "@/components/RestaurantTable";
import { SearchBar } from "@/components/SearchBar";

export default function Home() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 bg-zinc-50 px-6 py-8 font-sans">
      <main className="flex flex-col gap-4">
        <header>
          <h1 className="text-2xl font-semibold text-zinc-900">Claire Eats</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Phase 0 foundation: search and table boundaries are scaffolded.
          </p>
        </header>
        <SearchBar disabled />
        <RestaurantTable />
      </main>
    </div>
  );
}
