import type { ReadStateValue } from "@/db/schema/enums";
import type { ShelfEntry } from "@/lib/synthesise";
import { ShelfRow } from "@/components/shelf/ShelfRow";

const READ_STATE_LABELS: Record<ReadStateValue, string> = {
  want: "Want",
  reading: "Reading",
  read: "Read",
  skipped: "Skipped",
};

/**
 * Everything tracked, including the real books of a complete series, which
 * the Waiting Shelf excludes.
 *
 * COMPLETE is a property of the series, not of any one book, so there is no
 * synthetic "complete" entry: a finished series has no next book, and never
 * will, so inventing a phantom entry to carry the status would be modelling
 * the wrong thing. Instead the series' real book-row entries render as
 * usual, and are marked with a "Series complete" label when their seriesId
 * is in completeSeriesIds.
 *
 * Not virtualised yet. The 300 row test exercises the target scale; if it
 * becomes slow, virtualise then, with a measurement rather than a guess.
 */
export function LibraryGrid({
  entries,
  now,
  readStates,
  completeSeriesIds,
}: {
  entries: ShelfEntry[];
  now: Date;
  readStates: Map<string, ReadStateValue>;
  completeSeriesIds: Set<string>;
}) {
  if (entries.length === 0) {
    return (
      <p className="py-16 text-center font-display text-[18px] text-body">
        Nothing tracked yet.
      </p>
    );
  }

  return (
    <div>
      {entries.map((entry) => {
        const state = entry.bookId ? readStates.get(entry.bookId) : undefined;
        const seriesComplete = entry.seriesId
          ? completeSeriesIds.has(entry.seriesId)
          : false;
        return (
          <div key={entry.key}>
            <ShelfRow entry={entry} now={now} />
            {seriesComplete ? (
              <span className="font-mono text-[11px] uppercase text-verdigris">
                Series complete
              </span>
            ) : null}
            {state ? (
              <span className="font-mono text-[11px] uppercase text-verdigris">
                {READ_STATE_LABELS[state]}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
