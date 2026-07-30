import { formatStamp } from "@/lib/provenance";
import type { ProviderName } from "@/db/schema/enums";

/**
 * Which source said so, how long ago we checked, and whether a date moved.
 *
 * The direction to token mapping lives in the caller of formatMove, not
 * here: this component receives the already-computed { label, direction }
 * and only picks the colour. oxide means "date moved later" and nowhere
 * else in the app, so a later move renders oxide and an earlier move
 * renders verdigris, reinforcing the text label rather than replacing it.
 */
export function ProvenanceStamp({
  provider,
  lastVerifiedAt,
  now,
  move,
}: {
  provider: ProviderName;
  lastVerifiedAt: Date;
  now: Date;
  move?: { label: string; direction: "later" | "earlier" };
}) {
  const stamp = formatStamp({ provider, lastVerifiedAt, now });
  const moveToken = move ? (move.direction === "later" ? "oxide" : "verdigris") : undefined;

  return (
    <span data-provenance-stamp className="font-mono text-[11px] uppercase text-quiet">
      {stamp}
      {move ? (
        <span
          data-move-token={moveToken}
          className={moveToken === "oxide" ? "ml-2 text-oxide" : "ml-2 text-verdigris"}
        >
          {move.label}
        </span>
      ) : null}
    </span>
  );
}
