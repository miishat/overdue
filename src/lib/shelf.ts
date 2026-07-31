import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { DatePrecision, SeriesStatus } from "@/db/schema/enums";
import { authors, bookAuthors, books, series } from "@/db/schema/catalog";
import { releases, releaseSources } from "@/db/schema/releases";
import { tracks } from "@/db/schema/tracking";
import { OFFICIAL_PROVIDERS } from "@/providers/registry";
import { deriveStatus } from "@/resolution/status";
import { getCurrentUserId } from "./current-user";
import { isSameUtcMonth } from "./horizons";
import {
  synthesiseSeriesEntry,
  type ShelfEntry,
  type TrackedSeries,
} from "./synthesise";

/** Spec section 6. Configurable per user; no settings screen yet in M2. */
export const DEFAULT_HIATUS_THRESHOLD_YEARS = 4;

export interface TrackedBookRow {
  bookId: string;
  title: string;
  authorName: string | null;
  seriesId: string | null;
  seriesTitle: string | null;
  seriesPosition: number | null;
  coverUrl: string | null;
  releaseDate: Date | null;
  precision: DatePrecision | null;
  sourceOfficial: boolean;
  seriesStatus: SeriesStatus | null;
  lastSeriesReleaseAt: Date | null;
}

export interface ShelfDataSource {
  trackedBooks(userId: string): Promise<TrackedBookRow[]>;
  trackedSeries(userId: string): Promise<TrackedSeries[]>;
}

/**
 * Pure assembly: rows in, shelf entries out.
 *
 * Kept separate from the query layer so the correctness of this milestone is
 * testable without a database. The previous milestone learned that mocking the
 * persistence boundary hides real defects, so the seam is the injected
 * ShelfDataSource rather than a mocked module.
 */
export function buildShelf(input: {
  books: TrackedBookRow[];
  series: TrackedSeries[];
  now: Date;
  hiatusThresholdYears?: number;
  /**
   * The Waiting Shelf (default, false) and Library (true) diverge on exactly
   * one thing: whether an already-released book still earns a row once its
   * release month has passed. The shelf's purpose is "did anything change,"
   * so a backlist book from three years ago is noise; Library's purpose is
   * "everything I track," so it keeps the full backlist. Everything else
   * about assembly (author resolution, synthetic entries, the COMPLETE
   * guard) is identical, so this is a boolean on the one shared function
   * rather than a second copy of the mapping logic.
   */
  includeReleasedBacklist?: boolean;
}): ShelfEntry[] {
  const threshold =
    input.hiatusThresholdYears ?? DEFAULT_HIATUS_THRESHOLD_YEARS;

  const entries: ShelfEntry[] = input.books.map((row) => ({
    key: `book:${row.bookId}`,
    bookId: row.bookId,
    seriesId: row.seriesId,
    title: row.title,
    authorName: row.authorName,
    seriesTitle: row.seriesTitle,
    seriesPosition: row.seriesPosition,
    coverUrl: row.coverUrl,
    status: deriveStatus({
      now: input.now,
      date: row.releaseDate,
      precision: row.precision,
      hasBookRecord: true,
      sourceOfficial: row.sourceOfficial,
      seriesStatus: row.seriesStatus,
      lastSeriesReleaseAt: row.lastSeriesReleaseAt,
      hiatusThresholdYears: threshold,
    }),
    date: row.releaseDate,
    precision: row.precision,
    synthetic: false,
    lastSeriesReleaseAt: row.lastSeriesReleaseAt,
  }));

  // A series whose next entry is already known and still pending does not also
  // get a synthesised entry. The user is waiting on that book, not on a
  // hypothetical one after it.
  const seriesWithPendingEntry = new Set(
    input.books
      .filter(
        (row) =>
          row.seriesId !== null &&
          (row.releaseDate === null || row.releaseDate > input.now),
      )
      .map((row) => row.seriesId as string),
  );

  for (const s of input.series) {
    if (seriesWithPendingEntry.has(s.seriesId)) continue;
    const synthetic = synthesiseSeriesEntry(s, input.now, threshold);
    if (synthetic) entries.push(synthetic);
  }

  // Defensive only: deriveStatus returns COMPLETE solely when
  // seriesStatus === "complete" && !hasBookRecord, and book rows above
  // always pass hasBookRecord: true, so no book-row entry can reach this
  // filter as COMPLETE. synthesiseSeriesEntry already returns null for a
  // complete series, so this is unreachable given today's callers. Kept as
  // a guard in case a future caller changes that invariant.
  const withoutComplete = entries.filter(
    (entry) => entry.status !== "COMPLETE",
  );

  if (input.includeReleasedBacklist) return withoutComplete;

  // The Waiting Shelf only. A book-row entry whose date has already passed
  // is a backlist entry unless it released this calendar month: "this just
  // came out, go get it" is worth a row, an older backlist is not. Synthetic
  // entries and anything still in the future are untouched. "This month"
  // uses the same UTC year/month comparison horizonFor uses for its "This
  // month" bucket (see isSameUtcMonth in horizons.ts), so the shelf and the
  // horizon grouping cannot disagree about what counts as recent.
  return withoutComplete.filter((entry) => {
    if (entry.synthetic) return true;
    if (!entry.date) return true;
    if (entry.date.getTime() > input.now.getTime()) return true;
    return isSameUtcMonth(entry.date, input.now);
  });
}

/**
 * A book is "tracked" either directly (a track row pointing at the book) or
 * indirectly (a track row pointing at its series). Union the two id sets so
 * a book reachable both ways still appears exactly once. Extracted as a pure
 * function so this rule is unit-testable without a database.
 */
export function mergeTrackedBookIds(
  directBookIds: string[],
  seriesReachableBookIds: string[],
): string[] {
  return [...new Set([...directBookIds, ...seriesReachableBookIds])];
}

export async function loadShelf(
  source: ShelfDataSource,
  now: Date,
): Promise<ShelfEntry[]> {
  const userId = await getCurrentUserId();
  const [bookRows, seriesRows] = await Promise.all([
    source.trackedBooks(userId),
    source.trackedSeries(userId),
  ]);
  return buildShelf({ books: bookRows, series: seriesRows, now });
}

/**
 * Library's counterpart to loadShelf: same query shape, same assembly, but
 * keeps the full released backlist that the Waiting Shelf filters out. See
 * buildShelf's includeReleasedBacklist for why this is a flag on shared
 * assembly rather than a second copy of the mapping logic.
 */
export async function loadLibrary(
  source: ShelfDataSource,
  now: Date,
): Promise<ShelfEntry[]> {
  const userId = await getCurrentUserId();
  const [bookRows, seriesRows] = await Promise.all([
    source.trackedBooks(userId),
    source.trackedSeries(userId),
  ]);
  return buildShelf({
    books: bookRows,
    series: seriesRows,
    now,
    includeReleasedBacklist: true,
  });
}

/**
 * Live ShelfDataSource backed by Drizzle/Postgres.
 *
 * highestKnownPosition is a clean SQL aggregate (MAX(books.seriesPosition)
 * grouped by series), so it is computed in SQL. lastSeriesReleaseAt and
 * sourceOfficial are harder to express as a single join without a release
 * having more than one release_sources row (one per provider) fanning out
 * the book rows the join is trying to produce one-per-book, so per the
 * brief's guidance those two are fetched as small extra queries and reduced
 * in TypeScript. Row counts here are per-user and small (this is a
 * single-user v1 app), so the extra round trips are not a real cost.
 */
export const drizzleShelfSource: ShelfDataSource = {
  async trackedBooks(userId) {
    // A book is tracked either directly (tracks.bookId) or through its
    // series (tracks.seriesId). Tracking a series is the primary way
    // anything gets tracked in this app, so both paths must be resolved and
    // merged, or a series-tracked book's real releases never reach the
    // shelf and the suppression rule below has nothing to suppress against.
    const trackRows = await db
      .select({ bookId: tracks.bookId, seriesId: tracks.seriesId })
      .from(tracks)
      .where(eq(tracks.userId, userId));

    const directBookIds = trackRows
      .map((row) => row.bookId)
      .filter((id): id is string => id !== null);
    const trackedSeriesIds = trackRows
      .map((row) => row.seriesId)
      .filter((id): id is string => id !== null);

    const seriesReachableBookIds =
      trackedSeriesIds.length === 0
        ? []
        : (
            await db
              .select({ bookId: books.id })
              .from(books)
              .where(inArray(books.seriesId, trackedSeriesIds))
          ).map((row) => row.bookId);

    const bookIds = mergeTrackedBookIds(directBookIds, seriesReachableBookIds);
    if (bookIds.length === 0) return [];

    // Pin the release join to the region/format persist.ts actually writes
    // (see releases.ts defaults and persistResolvedBook) rather than
    // leaving the join ambiguous. v1 never writes a second release row for
    // a book, but the unique constraint is on (book_id, region, format), not
    // on book_id alone, so an unconstrained join could in principle match
    // more than one row and leave the "winning" one to database plan order.
    // Pinning region/format makes at most one release row match per book,
    // by construction, so no post-query dedup is needed.
    const rows = await db
      .select({
        bookId: books.id,
        title: books.title,
        seriesId: books.seriesId,
        seriesTitle: series.title,
        seriesPosition: books.seriesPosition,
        coverUrl: books.coverUrl,
        seriesStatus: series.status,
        releaseId: releases.id,
        releaseDate: releases.date,
        precision: releases.datePrecision,
      })
      .from(books)
      .leftJoin(series, eq(books.seriesId, series.id))
      .leftJoin(
        releases,
        and(
          eq(releases.bookId, books.id),
          eq(releases.region, "US"),
          eq(releases.format, "hardcover"),
        ),
      )
      .where(inArray(books.id, bookIds));

    const bookRows = rows;
    const releaseIds = bookRows
      .map((row) => row.releaseId)
      .filter((id): id is string => id !== null);
    const seriesIds = bookRows
      .map((row) => row.seriesId)
      .filter((id): id is string => id !== null);

    const [authorRows, sourceRows, lastReleaseRows] = await Promise.all([
      bookIds.length === 0
        ? Promise.resolve([])
        : db
            .select({
              bookId: bookAuthors.bookId,
              name: authors.name,
              position: bookAuthors.position,
            })
            .from(bookAuthors)
            .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
            .where(inArray(bookAuthors.bookId, bookIds)),
      releaseIds.length === 0
        ? Promise.resolve([])
        : db
            .select({
              releaseId: releaseSources.releaseId,
              provider: releaseSources.provider,
            })
            .from(releaseSources)
            .where(inArray(releaseSources.releaseId, releaseIds)),
      seriesIds.length === 0
        ? Promise.resolve([])
        : db
            .select({
              seriesId: books.seriesId,
              lastReleaseAt: sql<string | null>`max(${releases.date})`.as(
                "last_release_at",
              ),
            })
            .from(books)
            .innerJoin(releases, eq(releases.bookId, books.id))
            .where(
              and(
                inArray(books.seriesId, seriesIds),
                lte(releases.date, sql`current_date`),
              ),
            )
            .groupBy(books.seriesId),
    ]);

    // First author by position, per book.
    const bestAuthorPosition = new Map<string, number>();
    const authorByBook = new Map<string, string>();
    for (const row of authorRows) {
      const currentBest = bestAuthorPosition.get(row.bookId);
      if (currentBest === undefined || row.position < currentBest) {
        bestAuthorPosition.set(row.bookId, row.position);
        authorByBook.set(row.bookId, row.name);
      }
    }

    // Diverges slightly from persistResolvedBook (persist.ts:283-287): that
    // function also treats a release as official when provenance.releaseDate
    // names an official provider, even if that provider's source row was
    // never (or no longer) written. release_sources is the only signal
    // available at read time, so a release whose source rows are all absent
    // reads as unofficial (RUMORED) here even in the rare case persist.ts
    // would have stored it as ANNOUNCED. Not fixed here per review guidance
    // to avoid restructuring persist.ts's provenance handling.
    const officialByRelease = new Set(
      sourceRows
        .filter((row) => OFFICIAL_PROVIDERS[row.provider])
        .map((row) => row.releaseId),
    );

    const lastReleaseBySeries = new Map<string, Date>();
    for (const row of lastReleaseRows) {
      if (row.seriesId && row.lastReleaseAt) {
        lastReleaseBySeries.set(row.seriesId, new Date(row.lastReleaseAt));
      }
    }

    return bookRows.map((row) => ({
      bookId: row.bookId,
      title: row.title,
      authorName: authorByBook.get(row.bookId) ?? null,
      seriesId: row.seriesId,
      seriesTitle: row.seriesTitle,
      seriesPosition: row.seriesPosition === null ? null : Number(row.seriesPosition),
      coverUrl: row.coverUrl,
      releaseDate: row.releaseDate ? new Date(row.releaseDate) : null,
      precision: row.precision,
      sourceOfficial: row.releaseId !== null && officialByRelease.has(row.releaseId),
      seriesStatus: row.seriesStatus,
      lastSeriesReleaseAt: row.seriesId
        ? lastReleaseBySeries.get(row.seriesId) ?? null
        : null,
    }));
  },

  async trackedSeries(userId) {
    const rows = await db
      .select({
        seriesId: series.id,
        seriesTitle: series.title,
        seriesStatus: series.status,
        plannedLength: series.plannedLength,
      })
      .from(tracks)
      .innerJoin(series, eq(tracks.seriesId, series.id))
      .where(and(eq(tracks.userId, userId), isNotNull(tracks.seriesId)));

    if (rows.length === 0) return [];

    const seriesIds = rows.map((row) => row.seriesId);

    const [positionRows, lastReleaseRows] = await Promise.all([
      db
        .select({
          seriesId: books.seriesId,
          highestPosition: sql<string | null>`max(${books.seriesPosition})`.as(
            "highest_position",
          ),
        })
        .from(books)
        .where(inArray(books.seriesId, seriesIds))
        .groupBy(books.seriesId),
      db
        .select({
          seriesId: books.seriesId,
          lastReleaseAt: sql<string | null>`max(${releases.date})`.as(
            "last_release_at",
          ),
        })
        .from(books)
        .innerJoin(releases, eq(releases.bookId, books.id))
        .where(
          and(
            inArray(books.seriesId, seriesIds),
            lte(releases.date, sql`current_date`),
          ),
        )
        .groupBy(books.seriesId),
    ]);

    const positionBySeries = new Map<string, number>();
    for (const row of positionRows) {
      if (row.seriesId && row.highestPosition !== null) {
        positionBySeries.set(row.seriesId, Number(row.highestPosition));
      }
    }

    const lastReleaseBySeries = new Map<string, Date>();
    for (const row of lastReleaseRows) {
      if (row.seriesId && row.lastReleaseAt) {
        lastReleaseBySeries.set(row.seriesId, new Date(row.lastReleaseAt));
      }
    }

    return rows.map((row) => ({
      seriesId: row.seriesId,
      seriesTitle: row.seriesTitle,
      seriesStatus: row.seriesStatus,
      plannedLength: row.plannedLength,
      highestKnownPosition: positionBySeries.get(row.seriesId) ?? null,
      lastSeriesReleaseAt: lastReleaseBySeries.get(row.seriesId) ?? null,
    }));
  },
};
