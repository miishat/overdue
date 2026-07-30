import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { DatePrecision, SeriesStatus } from "@/db/schema/enums";
import { authors, bookAuthors, books, series } from "@/db/schema/catalog";
import { releases, releaseSources } from "@/db/schema/releases";
import { tracks } from "@/db/schema/tracking";
import { OFFICIAL_PROVIDERS } from "@/providers/registry";
import { deriveStatus } from "@/resolution/status";
import { getCurrentUserId } from "./current-user";
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

  // COMPLETE never reaches the shelf. Filtering here as well as in
  // synthesiseSeriesEntry covers a real book row belonging to a finished
  // series, which the synthesiser never sees.
  return entries.filter((entry) => entry.status !== "COMPLETE");
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
 * Live ShelfDataSource backed by Drizzle/Postgres.
 *
 * highestKnownPosition is a clean SQL aggregate (MAX(books.seriesPosition)
 * grouped by series), so it is computed in SQL. lastSeriesReleaseAt and
 * sourceOfficial are harder to express as a single join without either
 * duplicating book rows (a book can have more than one release row across
 * region/format, and a release can have more than one release_sources row)
 * or writing a much less readable query, so per the brief's guidance those
 * two are fetched as small extra queries and reduced in TypeScript. Row
 * counts here are per-user and small (this is a single-user v1 app), so the
 * extra round trips are not a real cost.
 */
export const drizzleShelfSource: ShelfDataSource = {
  async trackedBooks(userId) {
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
      .from(tracks)
      .innerJoin(books, eq(tracks.bookId, books.id))
      .leftJoin(series, eq(books.seriesId, series.id))
      .leftJoin(releases, eq(releases.bookId, books.id))
      .where(and(eq(tracks.userId, userId), isNotNull(tracks.bookId)));

    // A book can carry more than one release row (region/format), though v1
    // only ever writes US/hardcover. Reduce to one row per book here rather
    // than push that ambiguity into the SQL, preferring a release that has a
    // date over one that does not.
    type Row = (typeof rows)[number];
    const byBook = new Map<string, Row>();
    for (const row of rows) {
      const existing = byBook.get(row.bookId);
      if (!existing || (row.releaseDate !== null && existing.releaseDate === null)) {
        byBook.set(row.bookId, row);
      }
    }
    const bookRows = [...byBook.values()];

    const bookIds = bookRows.map((row) => row.bookId);
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
              and(inArray(books.seriesId, seriesIds), eq(releases.status, "RELEASED")),
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
          and(inArray(books.seriesId, seriesIds), eq(releases.status, "RELEASED")),
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
