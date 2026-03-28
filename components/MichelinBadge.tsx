import type { MichelinAward } from "@/lib/types";

type MichelinBadgeProps = {
  award: MichelinAward | null;
  greenStar?: boolean;
};

const AWARD_STYLES: Record<MichelinAward, { bg: string; label: string }> = {
  "3 Stars": { bg: "bg-red-100 text-red-800", label: "★★★" },
  "2 Stars": { bg: "bg-red-100 text-red-800", label: "★★" },
  "1 Star": { bg: "bg-red-100 text-red-800", label: "★" },
  "Bib Gourmand": { bg: "bg-orange-100 text-orange-800", label: "Bib" },
  "Michelin Guide": { bg: "bg-blue-100 text-blue-800", label: "Guide" },
};

/**
 * @deprecated Michelin UI rendering is currently archived due to sparse match coverage.
 * This component is kept for future re-enablement.
 */
export function MichelinBadge({ award, greenStar = false }: MichelinBadgeProps) {
  if (!award) return null;

  const style = AWARD_STYLES[award];
  const ariaLabel = greenStar ? `Michelin ${award}, Green Star` : `Michelin ${award}`;

  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={ariaLabel}>
      <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${style.bg}`} aria-hidden="true">
        {style.label}
      </span>
      {greenStar && (
        <span
          className="inline-block rounded bg-green-100 px-1 py-0.5 text-xs text-green-800"
          aria-hidden="true"
          title="Michelin Green Star"
        >
          Eco
        </span>
      )}
    </span>
  );
}
