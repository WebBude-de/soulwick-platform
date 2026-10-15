import { Sprite } from "@/components/ui/sprite";

/** Trophy for place 1, a coin for places 2 and 3, the plain number for everyone else. */
export function RankMedal({ rank, label }: { rank: number; label: string }) {
  if (rank > 3) {
    return (
      <span className="inline-flex min-w-10 items-center justify-end font-pixel text-lg text-muted">
        <span className="sr-only">{label}</span>
        <span aria-hidden="true">{rank}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex min-w-10 items-center justify-end gap-1.5">
      {rank === 1 ? (
        <Sprite alt={label} id="icon_leaderboard" scale={2} />
      ) : (
        <Sprite alt={label} id="gold_coin_4f" scale={2} still />
      )}
      <span aria-hidden="true" className="font-pixel text-gold text-lg">
        {rank}
      </span>
    </span>
  );
}
