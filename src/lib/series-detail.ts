import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { authors, bookAuthors, books, series } from "@/db/schema/catalog";
import { releases, releaseSources } from "@/db/schema/releases";
import { OFFICIAL_PROVIDERS } from "@/providers/registry";
import { deriveStatus } from "@/resolution/status";
import { DEFAULT_HIATUS_THRESHOLD_YEARS, type TrackedBookRow } from "./shelf";
import {
  synthesiseSeriesEntry,
  type ShelfEntry,
  type TrackedSeries,
} from "./synthesise";

/**
 * Pure assembly for the series detail run: books in order, plus the
 * synthetic next entry when the series is ongoing.
 *
 * Unlike buildShelf (src/lib/shelf.ts), this view does show COMPLETE-derived
 * entries in the sense that a complete series is allowed to render here at
 * all: synthesiseSeriesEntry still returns null for a complete series (there
 * is no next book to wait for), so completion is surfaced by the caller as a
 * property of the series, not as a ShelfEntry. See the page for the "Series
 * complete" marker, matching Task 15's Library.
 */
export function buildSeriesRun(input: {
  books: TrackedBookRow[];
  series: TrackedSeries;
  now: Date;
  hiatusThresholdYears?: number;
}): ShelfEntry[] {
  const threshold =
    input.hiatusThresholdYears ?? DEFAULT_HIATUS_THRESHOLD_YEARS;

  // Position ascending, with position-less entries last. A decimal position
  // (a novella at 2.5) sorts naturally between its integer neighbours because
  // this compares the numbers directly rather than truncating them.
  const sorted = [...input.books].sort((a, b) => {
    if (a.seriesPosition === null && b.seriesPosition === null) return 0;
    if (a.seriesPosition === null) return 1;
    if (b.seriesPosition === null) return -1;
    return a.seriesPosition - b.seriesPosition;
  });

  const entries: ShelfEntry[] = sorted.map((row) => ({
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

  // Mirrors buildShelf's suppression rule: a real book row that is still
  // undated or dated in the future is already the entry the user is waiting
  // on, so a synthesised "next book" on top of it would double it up.
  const hasPendingBook = input.books.some(
    (row) => row.releaseDate === null || row.releaseDate > input.now,
  );

  if (!hasPendingBook) {
    const synthetic = synthesiseSeriesEntry(input.series, input.now, threshold);
    if (synthetic) entries.push(synthetic);
  }

  return entries;
}

export interface SeriesDetailDataSource {
  seriesById(seriesId: string): Promise<TrackedSeries | null>;
  booksInSeries(seriesId: string): Promise<TrackedBookRow[]>;
}

export async function loadSeriesDetail(
  source: SeriesDetailDataSource,
  seriesId: string,
  now: Date,
): Promise<{ series: TrackedSeries; run: ShelfEntry[] } | null> {
  const seriesRow = await source.seriesById(seriesId);
  if (!seriesRow) return null;
  const bookRows = await source.booksInSeries(seriesId);
  const run = buildSeriesRun({ books: bookRows, series: seriesRow, now });
  return { series: seriesRow, run };
}

/**
 * Live SeriesDetailDataSource backed by Drizzle/Postgres.
 *
 * Unlike drizzleShelfSource, which scopes books to what a user tracks, this
 * scopes books to a single seriesId directly: the detail screen shows the
 * full real run of the series regardless of which of its books happen to be
 * individually tracked.
 */
export const drizzleSeriesDetailSource: SeriesDetailDataSource = {
  async seriesById(seriesId) {
    const rows = await db
      .select({
        seriesId: series.id,
        seriesTitle: series.title,
        seriesStatus: series.status,
        plannedLength: series.plannedLength,
      })
      .from(series)
      .where(eq(series.id, seriesId));

    const row = rows[0];
    if (!row) return null;

    const [positionRows, lastReleaseRows] = await Promise.all([
      db
        .select({
          highestPosition: sql<string | null>`max(${books.seriesPosition})`.as(
            "highest_position",
          ),
        })
        .from(books)
        .where(eq(books.seriesId, seriesId)),
      db
        .select({
          lastReleaseAt: sql<string | null>`max(${releases.date})`.as(
            "last_release_at",
          ),
        })
        .from(books)
        .innerJoin(releases, eq(releases.bookId, books.id))
        .where(
          and(eq(books.seriesId, seriesId), lte(releases.date, sql`current_date`)),
        ),
    ]);

    const highestPosition = positionRows[0]?.highestPosition ?? null;
    const lastReleaseAt = lastReleaseRows[0]?.lastReleaseAt ?? null;

    return {
      seriesId: row.seriesId,
      seriesTitle: row.seriesTitle,
      seriesStatus: row.seriesStatus,
      plannedLength: row.plannedLength,
      highestKnownPosition:
        highestPosition === null ? null : Number(highestPosition),
      lastSeriesReleaseAt: lastReleaseAt ? new Date(lastReleaseAt) : null,
    };
  },

  async booksInSeries(seriesId) {
    // Pin the release join to the region/format persist.ts actually writes,
    // same reasoning as drizzleShelfSource.trackedBooks in src/lib/shelf.ts:
    // the unique constraint is on (book_id, region, format), not book_id
    // alone, so an unconstrained join could match more than one row.
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
      .where(eq(books.seriesId, seriesId));

    const bookIds = rows.map((row) => row.bookId);
    const releaseIds = rows
      .map((row) => row.releaseId)
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
      db
        .select({
          lastReleaseAt: sql<string | null>`max(${releases.date})`.as(
            "last_release_at",
          ),
        })
        .from(books)
        .innerJoin(releases, eq(releases.bookId, books.id))
        .where(
          and(eq(books.seriesId, seriesId), lte(releases.date, sql`current_date`)),
        ),
    ]);

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

    const lastReleaseAt = lastReleaseRows[0]?.lastReleaseAt
      ? new Date(lastReleaseRows[0].lastReleaseAt)
      : null;

    return rows.map((row) => ({
      bookId: row.bookId,
      title: row.title,
      authorName: authorByBook.get(row.bookId) ?? null,
      seriesId: row.seriesId,
      seriesTitle: row.seriesTitle,
      seriesPosition:
        row.seriesPosition === null ? null : Number(row.seriesPosition),
      coverUrl: row.coverUrl,
      releaseDate: row.releaseDate ? new Date(row.releaseDate) : null,
      precision: row.precision,
      sourceOfficial:
        row.releaseId !== null && officialByRelease.has(row.releaseId),
      seriesStatus: row.seriesStatus,
      lastSeriesReleaseAt: lastReleaseAt,
    }));
  },
};
