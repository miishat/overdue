import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import type { ProviderName } from "@/db/schema/enums";
import { books, series } from "@/db/schema/catalog";
import { changeLog } from "@/db/schema/changelog";
import { externalIds } from "@/db/schema/identity";
import { notificationQueue } from "@/db/schema/push";
import { releases, releaseSources } from "@/db/schema/releases";
import { getCurrentUserId } from "@/lib/current-user";
import { DEFAULT_HIATUS_THRESHOLD_YEARS, mergeTrackedBookIds } from "@/lib/shelf";
import { persistResolvedBook } from "@/lib/persist";
import { providers, OFFICIAL_PROVIDERS } from "@/providers/registry";
import type { ProviderBook } from "@/providers/types";
import { resolveGroup } from "@/resolution/resolve";
import { deriveStatus } from "@/resolution/status";
import { tracks } from "@/db/schema/tracking";
import type { RefreshPort } from "./run";
import type { BookSnapshot } from "./snapshot";

/**
 * Reads the current row set for one book and reduces it to a BookSnapshot.
 *
 * Status is derived here rather than read from releases.status, mirroring
 * drizzleShelfSource: the M2 review's Critical finding was a query trusting a
 * stale stored status column, so this port recomputes status from the raw
 * date/precision/official/series columns every time instead of trusting
 * whatever was last written to that column.
 */
async function loadStoredSnapshot(bookId: string): Promise<BookSnapshot | null> {
  const bookRows = await db
    .select({
      id: books.id,
      title: books.title,
      seriesId: books.seriesId,
      seriesPosition: books.seriesPosition,
      coverUrl: books.coverUrl,
      seriesStatus: series.status,
    })
    .from(books)
    .leftJoin(series, eq(books.seriesId, series.id))
    .where(eq(books.id, bookId))
    .limit(1);

  const book = bookRows[0];
  if (!book) return null;

  const releaseRows = await db
    .select({
      id: releases.id,
      date: releases.date,
      datePrecision: releases.datePrecision,
    })
    .from(releases)
    .where(
      and(
        eq(releases.bookId, bookId),
        eq(releases.region, "US"),
        eq(releases.format, "hardcover"),
      ),
    )
    .limit(1);

  const release = releaseRows[0] ?? null;

  let sourceOfficial = false;
  let sourceProvider: ProviderName | null = null;

  if (release) {
    const sourceRows = await db
      .select({
        provider: releaseSources.provider,
        trustRank: releaseSources.trustRank,
      })
      .from(releaseSources)
      .where(eq(releaseSources.releaseId, release.id));

    sourceOfficial = sourceRows.some((row) => OFFICIAL_PROVIDERS[row.provider]);

    let best: { provider: ProviderName; trustRank: number } | null = null;
    for (const row of sourceRows) {
      if (!best || row.trustRank > best.trustRank) best = row;
    }
    sourceProvider = best?.provider ?? null;
  }

  const now = new Date();

  let lastSeriesReleaseAt: Date | null = null;
  if (book.seriesId) {
    const seriesId = book.seriesId;
    const lastReleaseRows = await db
      .select({ date: releases.date })
      .from(releases)
      .innerJoin(books, eq(releases.bookId, books.id))
      .where(eq(books.seriesId, seriesId));

    for (const row of lastReleaseRows) {
      if (!row.date) continue;
      const candidate = new Date(row.date);
      if (candidate.getTime() > now.getTime()) continue;
      if (!lastSeriesReleaseAt || candidate.getTime() > lastSeriesReleaseAt.getTime()) {
        lastSeriesReleaseAt = candidate;
      }
    }
  }

  const status = deriveStatus({
    now,
    date: release?.date ? new Date(release.date) : null,
    precision: release?.datePrecision ?? null,
    hasBookRecord: true,
    sourceOfficial,
    seriesStatus: book.seriesStatus,
    lastSeriesReleaseAt,
    hiatusThresholdYears: DEFAULT_HIATUS_THRESHOLD_YEARS,
  });

  return {
    bookId: book.id,
    title: book.title,
    seriesId: book.seriesId,
    seriesPosition: book.seriesPosition === null ? null : Number(book.seriesPosition),
    coverUrl: book.coverUrl,
    releaseDate: release?.date ?? null,
    datePrecision: release?.datePrecision ?? null,
    status,
    sourceProvider,
  };
}

/**
 * Re-fetches every provider this book is already known by (external_ids),
 * through the registry's provider list rather than any single adapter.
 * A provider that fails or times out simply contributes nothing, exactly
 * like searchAcross, so one flaky provider cannot fail the whole refetch.
 */
async function fetchProviderBooks(bookId: string): Promise<ProviderBook[]> {
  const idRows = await db
    .select({
      provider: externalIds.provider,
      externalId: externalIds.externalId,
    })
    .from(externalIds)
    .where(and(eq(externalIds.entityType, "book"), eq(externalIds.entityId, bookId)));

  const settled = await Promise.allSettled(
    idRows.map((row) => {
      const provider = providers.find((p) => p.name === row.provider);
      if (!provider) return Promise.resolve(null);
      return provider.getBook(row.externalId);
    }),
  );

  return settled.flatMap((outcome) =>
    outcome.status === "fulfilled" && outcome.value ? [outcome.value] : [],
  );
}

/**
 * Live RefreshPort backed by Drizzle/Postgres.
 *
 * THE WRITE-BACK HAZARD: RefreshPort has no separate "save the re-fetched
 * snapshot" method, and runRefresh never asks for one. Bolting a new method
 * onto the port and hoping run.ts's orchestration calls it at the right
 * moment would recreate the exact defect this task is warning about, just
 * one layer removed. Instead, refetchSnapshot itself persists: it resolves
 * the freshly fetched provider records with the same resolveGroup used at
 * discovery time, then calls persistResolvedBook (src/lib/persist.ts),
 * the same tested function M1's discovery flow uses to write books,
 * releases, and release_sources. It then re-reads the row it just wrote via
 * loadStoredSnapshot, so the snapshot returned to runRefresh IS the row now
 * sitting in Postgres, not a value reconstructed in memory that could drift
 * from what got persisted. A second run's currentSnapshot() therefore reads
 * back the same values refetchSnapshot just wrote, the diff is empty, and no
 * duplicate change_log rows or duplicate date_change alerts accumulate. This
 * needed no change to the RefreshPort interface: the persistence step lives
 * entirely inside the one method already responsible for talking to
 * providers.
 */
export const drizzleRefreshPort: RefreshPort = {
  async candidates() {
    const userId = await getCurrentUserId();

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

    return db
      .select({
        bookId: books.id,
        seriesId: books.seriesId,
        lastRefreshedAt: books.lastRefreshedAt,
      })
      .from(books)
      .where(inArray(books.id, bookIds));
  },

  async currentSnapshot(bookId) {
    return loadStoredSnapshot(bookId);
  },

  async refetchSnapshot(bookId) {
    const fetched = await fetchProviderBooks(bookId);
    // No provider still knows this book. Returning null here is exactly the
    // "providers no longer returning the book" case runRefresh already
    // handles: it is treated as a successful, changeless refresh rather than
    // a failure, so the book still gets marked refreshed and rotates to the
    // back of the queue.
    if (fetched.length === 0) return null;

    const resolved = resolveGroup({ key: bookId, records: fetched });
    await persistResolvedBook(resolved);

    return loadStoredSnapshot(bookId);
  },

  async writeChanges(rows) {
    if (rows.length === 0) return;

    await db.insert(changeLog).values(
      rows.map((row) => ({
        entityType: row.entityType,
        entityId: row.entityId,
        field: row.field,
        oldValue: row.oldValue,
        newValue: row.newValue,
        provider: row.provider,
      })),
    );
  },

  async markRefreshed(bookIds, at) {
    if (bookIds.length === 0) return;
    await db.update(books).set({ lastRefreshedAt: at }).where(inArray(books.id, bookIds));
  },

  async enqueue(userId, kind, payload) {
    await db.insert(notificationQueue).values({ userId, kind, payload });
  },
};
