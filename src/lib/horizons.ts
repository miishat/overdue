import type { DatePrecision } from "@/db/schema/enums";
import type { ShelfEntry } from "./synthesise";

/** Horizon names are copied verbatim from the spec, section 8. */
export const HORIZONS = [
  "This month",
  "Next 3 months",
  "Later this year",
  "Dated further out",
  "No date yet",
  "Not announced",
] as const;

export type Horizon = (typeof HORIZONS)[number];

export interface HorizonGroup {
  horizon: Horizon;
  entries: ShelfEntry[];
}

/**
 * More precise sorts first on a date tie, so a confirmed day appears above a
 * season window that happens to share its stored date.
 */
const PRECISION_RANK: Record<DatePrecision, number> = {
  day: 0,
  month: 1,
  quarter: 2,
  season: 3,
  year: 4,
};

function monthsBetween(from: Date, to: Date): number {
  return (
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth())
  );
}

export function horizonFor(entry: ShelfEntry, now: Date): Horizon {
  // An undated entry is separated by whether anything is known to exist at
  // all. ANNOUNCED and RUMORED are real records; EXPECTED and HIATUS are not.
  if (!entry.date) {
    return entry.status === "ANNOUNCED" || entry.status === "RUMORED"
      ? "No date yet"
      : "Not announced";
  }

  const months = monthsBetween(now, entry.date);

  if (months === 0) return "This month";
  if (months > 0 && months <= 3) return "Next 3 months";
  if (entry.date.getUTCFullYear() === now.getUTCFullYear()) {
    return "Later this year";
  }
  // A past date from an earlier year still reads as dated, not undated.
  return "Dated further out";
}

function compare(a: ShelfEntry, b: ShelfEntry): number {
  // Undated entries have nothing to order on but their title.
  if (!a.date && !b.date) return a.title.localeCompare(b.title);
  if (!a.date) return 1;
  if (!b.date) return -1;

  const byDate = a.date.getTime() - b.date.getTime();
  if (byDate !== 0) return byDate;

  const rankA = a.precision ? PRECISION_RANK[a.precision] : Number.MAX_SAFE_INTEGER;
  const rankB = b.precision ? PRECISION_RANK[b.precision] : Number.MAX_SAFE_INTEGER;
  if (rankA !== rankB) return rankA - rankB;

  return a.title.localeCompare(b.title);
}

export function groupByHorizon(
  entries: ShelfEntry[],
  now: Date,
): HorizonGroup[] {
  const buckets = new Map<Horizon, ShelfEntry[]>();

  for (const entry of entries) {
    // COMPLETE lives in Library and Series detail only, never here.
    if (entry.status === "COMPLETE") continue;

    const horizon = horizonFor(entry, now);
    const bucket = buckets.get(horizon);
    if (bucket) {
      bucket.push(entry);
    } else {
      buckets.set(horizon, [entry]);
    }
  }

  // Iterate HORIZONS rather than the map so order is the spec's, not
  // insertion order, and empty horizons drop out.
  return HORIZONS.flatMap((horizon) => {
    const entries = buckets.get(horizon);
    if (!entries || entries.length === 0) return [];
    return [{ horizon, entries: [...entries].sort(compare) }];
  });
}
