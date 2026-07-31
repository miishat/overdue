import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db/client";
import type { ProviderName } from "@/db/schema/enums";
import { books, series } from "@/db/schema/catalog";
import { changeLog } from "@/db/schema/changelog";
import { externalIds } from "@/db/schema/identity";
import { notificationQueue } from "@/db/schema/push";
import { releases, releaseSources } from "@/db/schema/releases";
import { getCurrentUserId } from "@/lib/current-user";
import { DEFAULT_HIATUS_THRESHOLD_YEARS, mergeTrackedBookIds } from "@/lib/shelf";
import { TRUST_RANK, persistResolvedBook } from "@/lib/persist";
import { providers, OFFICIAL_PROVIDERS } from "@/providers/registry";
import { resolveGroup, type ResolvedBook } from "@/resolution/resolve";
import { deriveStatus } from "@/resolution/status";
import { tracks } from "@/db/schema/tracking";
import type { RefreshPort } from "./run";
import type { BookSnapshot } from "./snapshot";
import {
  fetchKnownSources,
  type KnownSource,
  type StoredRelease,
} from "./sources";

/**
 * Reads the current row set for one book and reduces it to a BookSnapshot.
 *
 * Status is derived here rather than read from releases.status, mirroring
 * drizzleShelfSource: the M2 review's Critical finding was a query trusting a
 * stale stored status column, so this port recomputes status from the raw
 * date/precision/official/series columns every time instead of trusting
 * whatever was last written to that column.
 *
 * `now` is the run's single clock, threaded in from runRefresh, so that this
 * read and the re-fetch it will be diffed against cannot straddle a release
 * instant and manufacture a status change out of identical data.
 *
 * There is deliberately no per-book scan of every release in the series here.
 * hasBookRecord is unconditionally true on this path (we are looking at a
 * stored book), and deriveStatus reads seriesStatus/lastSeriesReleaseAt only
 * on the !hasBookRecord branch, so that scan was unaggregated dead work.
 */
async function loadStoredSnapshot(
  bookId: string,
  now: Date,
): Promise<BookSnapshot | null> {
  const bookRows = await db
    .select({
      id: books.id,
      title: books.title,
      seriesId: books.seriesId,
      seriesPosition: books.seriesPosition,
      coverUrl: books.coverUrl,
    })
    .from(books)
    .where(eq(books.id, bookId))
    .limit(1);

  const book = bookRows[0];
  if (!book) return null;

  const release = await loadStoredRelease(bookId);

  let sourceOfficial = false;
  let sourceProvider: ProviderName | null = null;

  if (release) {
    sourceOfficial = release.sources.some((row) => OFFICIAL_PROVIDERS[row.provider]);

    let best: { provider: ProviderName; trustRank: number } | null = null;
    for (const row of release.sources) {
      if (!best || row.trustRank > best.trustRank) best = row;
    }
    sourceProvider = best?.provider ?? null;
  }

  const status = deriveStatus({
    now,
    date: release?.date ? new Date(release.date) : null,
    precision: release?.datePrecision ?? null,
    hasBookRecord: true,
    sourceOfficial,
    seriesStatus: null,
    lastSeriesReleaseAt: null,
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

async function loadStoredRelease(bookId: string): Promise<StoredRelease | null> {
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

  const release = releaseRows[0];
  if (!release) return null;

  const sources = await db
    .select({
      provider: releaseSources.provider,
      sourceUrl: releaseSources.sourceUrl,
      valueSeen: releaseSources.valueSeen,
      trustRank: releaseSources.trustRank,
    })
    .from(releaseSources)
    .where(eq(releaseSources.releaseId, release.id));

  return { ...release, sources };
}

/** Reads the (provider, externalId) pairs this book is already known by. */
async function loadKnownSources(bookId: string): Promise<KnownSource[]> {
  return db
    .select({
      provider: externalIds.provider,
      externalId: externalIds.externalId,
    })
    .from(externalIds)
    .where(and(eq(externalIds.entityType, "book"), eq(externalIds.entityId, bookId)));
}

/**
 * Looks up the series a resolved book would link to WITHOUT creating one.
 *
 * refetchSnapshot must not write, and upsertSeries inserts. Mirroring
 * persistResolvedBook's rule that seriesId is only filled in when the book is
 * not already linked keeps the predicted snapshot honest for the common case.
 */
async function lookupSeriesId(book: ResolvedBook): Promise<string | null> {
  const provider = book.provenance.seriesExternalId;
  if (book.seriesExternalId && provider) {
    const byExternalId = await db
      .select({ entityId: externalIds.entityId })
      .from(externalIds)
      .where(
        and(
          eq(externalIds.entityType, "series"),
          eq(externalIds.provider, provider),
          eq(externalIds.externalId, book.seriesExternalId),
        ),
      )
      .limit(1);
    if (byExternalId[0]) return byExternalId[0].entityId;
  }

  if (!book.seriesName) return null;

  const byTitle = await db
    .select({ id: series.id })
    .from(series)
    .where(eq(series.title, book.seriesName))
    .limit(1);

  return byTitle[0]?.id ?? null;
}

/**
 * Predicts the snapshot the stored rows WOULD hold after this resolution is
 * committed, without committing it.
 *
 * Each field mirrors persistResolvedBook's own write rule, so that the diff
 * runRefresh records is the diff the later commit actually produces.
 */
async function predictSnapshot(
  stored: BookSnapshot,
  resolved: ResolvedBook,
  now: Date,
): Promise<BookSnapshot> {
  const releaseDate = resolved.releaseDate ?? null;
  const datePrecision = resolved.datePrecision ?? null;

  const sourceOfficial =
    resolved.sources.some((source) => OFFICIAL_PROVIDERS[source.provider]) ||
    (resolved.provenance.releaseDate
      ? OFFICIAL_PROVIDERS[resolved.provenance.releaseDate]
      : false);

  let sourceProvider: ProviderName | null = null;
  for (const source of resolved.sources) {
    if (!sourceProvider || TRUST_RANK[source.provider] > TRUST_RANK[sourceProvider]) {
      sourceProvider = source.provider;
    }
  }

  return {
    bookId: stored.bookId,
    title: resolved.title || stored.title,
    // persistResolvedBook only ever fills seriesId in, never overwrites it.
    seriesId: stored.seriesId ?? (await lookupSeriesId(resolved)),
    seriesPosition: resolved.seriesPosition ?? stored.seriesPosition,
    coverUrl: resolved.coverUrl ?? stored.coverUrl,
    releaseDate,
    datePrecision,
    status: deriveStatus({
      now,
      date: releaseDate ? new Date(releaseDate) : null,
      precision: datePrecision,
      hasBookRecord: true,
      sourceOfficial,
      seriesStatus: null,
      lastSeriesReleaseAt: null,
      hiatusThresholdYears: DEFAULT_HIATUS_THRESHOLD_YEARS,
    }),
    sourceProvider,
  };
}

/**
 * The resolutions refetchSnapshot produced but has not yet written back, keyed
 * by bookId for the duration of one run, so that commitRefetched does not have
 * to re-do the provider calls and the resolution.
 */
const pendingResolved = new Map<string, ResolvedBook>();

/**
 * Live RefreshPort backed by Drizzle/Postgres.
 *
 * See the RefreshPort interface in run.ts for why refetchSnapshot is read-only
 * and commitRefetched is a separate, later step. In short: change_log is
 * append-only history, and a change that is committed to books/releases before
 * its history row is written is permanently lost if the run dies in between.
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

  async currentSnapshot(bookId, now) {
    return loadStoredSnapshot(bookId, now);
  },

  async refetchSnapshot(bookId, now) {
    const stored = await loadStoredSnapshot(bookId, now);
    if (!stored) return null;

    const release = await loadStoredRelease(bookId);
    const fetched = await fetchKnownSources(
      providers,
      await loadKnownSources(bookId),
      release,
    );
    // No provider still knows this book. Returning null here is exactly the
    // "providers no longer returning the book" case runRefresh already
    // handles: it is treated as a successful, changeless refresh rather than
    // a failure, so the book still gets marked refreshed and rotates to the
    // back of the queue. Nothing is written, so a manual-only book keeps
    // everything it has.
    if (fetched.length === 0) {
      pendingResolved.delete(bookId);
      return null;
    }

    const resolved = resolveGroup({ key: bookId, records: fetched });
    pendingResolved.set(bookId, resolved);

    return predictSnapshot(stored, resolved, now);
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

  async commitRefetched(bookId) {
    const resolved = pendingResolved.get(bookId);
    if (!resolved) return;

    try {
      // Pre-check, so the corruption is prevented rather than merely reported.
      const owners = await db
        .select({ entityId: externalIds.entityId })
        .from(externalIds)
        .where(
          and(
            eq(externalIds.entityType, "book"),
            or(
              ...resolved.sources.map((source) =>
                and(
                  eq(externalIds.provider, source.provider),
                  eq(externalIds.externalId, source.externalId),
                ),
              ),
            ),
          ),
        );
      const foreign = owners.find((row) => row.entityId !== bookId);
      if (foreign) {
        throw new Error(
          `refresh write-back would target book ${foreign.entityId} but the snapshot was read from ${bookId}`,
        );
      }

      const written = await persistResolvedBook(resolved);
      // findExistingBookId matches with or(...) across every source and takes
      // limit 1 with no ordering. If any re-fetched ProviderBook carries an
      // externalId that now maps to a DIFFERENT book row, persist writes to
      // that row while this book's snapshot was read from the original: the
      // wrong row is silently overwritten and this book's diff stays
      // permanently empty. Throwing turns that cross-book corruption into a
      // recorded per-book failure.
      if (written.bookId !== bookId) {
        throw new Error(
          `refresh write-back resolved to book ${written.bookId} but the snapshot was read from ${bookId}`,
        );
      }
    } finally {
      pendingResolved.delete(bookId);
    }
  },

  async markRefreshed(bookIds, at) {
    if (bookIds.length === 0) return;
    await db.update(books).set({ lastRefreshedAt: at }).where(inArray(books.id, bookIds));
  },

  async enqueue(userId, kind, payload) {
    await db.insert(notificationQueue).values({ userId, kind, payload });
  },
};
