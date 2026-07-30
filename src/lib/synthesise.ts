import type {
  DatePrecision,
  ReleaseStatus,
  SeriesStatus,
} from "@/db/schema/enums";
import { deriveStatus } from "@/resolution/status";

export interface ShelfEntry {
  /** Stable key for React. Synthetic entries use `synthetic:<seriesId>`. */
  key: string;
  /** Null for a synthetic entry, because no book row exists. */
  bookId: string | null;
  seriesId: string | null;
  title: string;
  authorName: string | null;
  seriesTitle: string | null;
  seriesPosition: number | null;
  coverUrl: string | null;
  status: ReleaseStatus;
  date: Date | null;
  precision: DatePrecision | null;
  /** True when this entry has no book row and was synthesised at read time. */
  synthetic: boolean;
  /** For HIATUS, the last release in the series, used to render elapsed time. */
  lastSeriesReleaseAt: Date | null;
}

export interface TrackedSeries {
  seriesId: string;
  seriesTitle: string;
  seriesStatus: SeriesStatus;
  plannedLength: number | null;
  highestKnownPosition: number | null;
  lastSeriesReleaseAt: Date | null;
}

/**
 * Build the "next book in this series" entry that has no book row yet.
 *
 * Spec Change 6: these are never written to the books table, because a
 * placeholder row would surface in search, import, and read state. They are
 * synthesised on render and discarded.
 *
 * Returns null when the series should contribute nothing to the shelf.
 */
export function synthesiseSeriesEntry(
  series: TrackedSeries,
  now: Date,
  hiatusThresholdYears: number,
): ShelfEntry | null {
  // COMPLETE never appears on the Waiting Shelf. It lives in Library and
  // Series detail only, so a finished series contributes nothing here.
  if (series.seriesStatus === "complete") return null;

  // A series that has reached its stated length has no next entry to wait for.
  if (
    series.plannedLength !== null &&
    series.highestKnownPosition !== null &&
    series.highestKnownPosition >= series.plannedLength
  ) {
    return null;
  }

  // Novellas sit at fractional positions (2.5), so the next whole entry after
  // 2.5 is 3, not 3.5.
  const nextPosition =
    series.highestKnownPosition === null
      ? 1
      : Math.floor(series.highestKnownPosition) + 1;

  const status = deriveStatus({
    now,
    date: null,
    precision: null,
    hasBookRecord: false,
    sourceOfficial: false,
    seriesStatus: series.seriesStatus,
    lastSeriesReleaseAt: series.lastSeriesReleaseAt,
    hiatusThresholdYears,
  });

  return {
    key: `synthetic:${series.seriesId}`,
    bookId: null,
    seriesId: series.seriesId,
    title: `Book ${nextPosition}`,
    authorName: null,
    seriesTitle: series.seriesTitle,
    seriesPosition: nextPosition,
    coverUrl: null,
    status,
    date: null,
    precision: null,
    synthetic: true,
    lastSeriesReleaseAt: series.lastSeriesReleaseAt,
  };
}
