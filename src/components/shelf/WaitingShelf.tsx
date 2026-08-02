import Link from "next/link";
import { groupByHorizon } from "@/lib/horizons";
import type { ShelfEntry } from "@/lib/synthesise";
import { ShelfRow } from "./ShelfRow";

export function WaitingShelf({
  entries,
  now,
  changedIds = new Set(),
}: {
  entries: ShelfEntry[];
  now: Date;
  /** Book ids that changed since the user's last shelf view (Task 16). */
  changedIds?: Set<string>;
}) {
  const groups = groupByHorizon(entries, now);

  if (groups.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="font-display text-[18px] text-body">
          Nothing on the shelf yet.
        </p>
        <Link
          href="/search"
          className="mt-3 inline-block text-[14px] text-verdigris"
        >
          Find a book or series
        </Link>
      </div>
    );
  }

  return (
    <div>
      {groups.map((group) => (
        <section key={group.horizon} className="mb-8">
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-wide text-quiet">
            {group.horizon}
          </h2>
          {group.entries.map((entry) => (
            <ShelfRow
              key={entry.key}
              entry={entry}
              now={now}
              changed={entry.bookId !== null && changedIds.has(entry.bookId)}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
