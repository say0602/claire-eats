type MichelinBadgeProps = {
  award: "1 Star" | "2 Stars" | "3 Stars" | "Bib Gourmand" | null;
};

export function MichelinBadge({ award }: MichelinBadgeProps) {
  if (!award) return null;
  return <span className="rounded bg-zinc-100 px-2 py-1 text-xs">{award}</span>;
}
