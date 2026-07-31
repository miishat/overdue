import { formatStamp } from "@/lib/provenance";
import type { ProviderName } from "@/db/schema/enums";

/**
 * Which source said so, how long ago we checked, and whether a date moved.
 *
 * The direction itself is computed by the caller, via formatMove: this
 * component only receives the already-computed { label, direction } and
 * picks the colour from it. oxide means "date moved later" and nowhere else
 * in the app, so a later move renders oxide and an earlier move renders
 * verdigris, reinforcing the text label rather than replacing it. The token
 * and the class share one lookup so they cannot desync.
 */
const MOVE_TOKEN: Record<"later" | "earlier", "oxide" | "verdigris"> = {
  later: "oxide",
  earlier: "verdigris",
};

const MOVE_CLASS: Record<"oxide" | "verdigris", string> = {
  oxide: "ml-2 text-oxide",
  verdigris: "ml-2 text-verdigris",
};

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
  const moveToken = move ? MOVE_TOKEN[move.direction] : undefined;

  return (
    <span data-provenance-stamp className="font-mono text-[11px] uppercase text-quiet">
      {stamp}
      {move && moveToken ? (
        <span data-move-token={moveToken} className={MOVE_CLASS[moveToken]}>
          {move.label}
        </span>
      ) : null}
    </span>
  );
}
