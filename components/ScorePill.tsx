type ScorePillProps = {
  score: number | null;
};

function scoreColorClass(score: number) {
  if (score >= 9.0) return "bg-emerald-100 text-emerald-800";
  if (score >= 8.0) return "bg-teal-100 text-teal-800";
  if (score >= 7.0) return "bg-sky-100 text-sky-800";
  if (score >= 6.0) return "bg-amber-100 text-amber-800";
  return "bg-zinc-100 text-zinc-600";
}

export function ScorePill({ score }: ScorePillProps) {
  if (score === null) {
    return <span className="text-zinc-400">-</span>;
  }

  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${scoreColorClass(score)}`}
    >
      {score.toFixed(1)}
    </span>
  );
}
