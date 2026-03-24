type ScorePillProps = {
  score: number | null;
};

export function ScorePill({ score }: ScorePillProps) {
  return (
    <span className="rounded bg-zinc-100 px-2 py-1 text-xs">
      {score === null ? "-" : score.toFixed(1)}
    </span>
  );
}
