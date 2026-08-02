import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { changeLog } from "@/db/schema/changelog";
import { books } from "@/db/schema/catalog";
import { tracks } from "@/db/schema/tracking";
import { users } from "@/db/schema/users";
import { mergeTrackedBookIds } from "./shelf";

/**
 * Which book ids changed after the baseline.
 *
 * Null baseline means the user has never opened the shelf. Per spec, that
 * badges nothing (an empty set), not everything: the first view has no
 * "since" to compare against, and badging every row on day one is noise, not
 * signal. A row observed exactly at the baseline was already visible on the
 * last view, so it is excluded too; only strictly-after counts as new.
 */
export function changedBookIds(input: {
  rows: Array<{ entityId: string; observedAt: Date }>;
  since: Date | null;
}): Set<string> {
  const result = new Set<string>();
  if (input.since === null) return result;

  const sinceMs = input.since.getTime();
  for (const row of input.rows) {
    if (row.observedAt.getTime() > sinceMs) {
      result.add(row.entityId);
    }
  }
  return result;
}

export interface SeenStore {
  lastViewedAt(userId: string): Promise<Date | null>;
  markViewed(userId: string, at: Date): Promise<void>;
  changesSince(
    userId: string,
    since: Date | null,
  ): Promise<Array<{ entityId: string; observedAt: Date }>>;
}

/**
 * Live SeenStore backed by Drizzle/Postgres.
 *
 * changesSince scopes to books the user actually tracks (directly or through
 * a tracked series), the same union loadShelf uses, so the badge cannot fire
 * for a book the shelf would never show in the first place.
 */
export const drizzleSeenStore: SeenStore = {
  async lastViewedAt(userId) {
    const rows = await db
      .select({ lastShelfViewedAt: users.lastShelfViewedAt })
      .from(users)
      .where(eq(users.id, userId));
    return rows[0]?.lastShelfViewedAt ?? null;
  },

  async markViewed(userId, at) {
    await db.update(users).set({ lastShelfViewedAt: at }).where(eq(users.id, userId));
  },

  async changesSince(userId, since) {
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

    // The SQL boundary here (gt) and the strict "> sinceMs" check
    // changedBookIds applies again in TypeScript are deliberately redundant.
    // This is defensive, not accidental duplication: if this query's
    // operator were ever changed from gt to gte (e.g. during a refactor),
    // rows observed exactly at the baseline would leak through here, but
    // changedBookIds' own strict-greater-than check would still exclude
    // them, so the "only strictly-after counts as new" rule holds either
    // way. Safe to leave both in place.
    const whereClause =
      since === null
        ? and(eq(changeLog.entityType, "book"), inArray(changeLog.entityId, bookIds))
        : and(
            eq(changeLog.entityType, "book"),
            inArray(changeLog.entityId, bookIds),
            gt(changeLog.observedAt, since),
          );

    const rows = await db
      .select({ entityId: changeLog.entityId, observedAt: changeLog.observedAt })
      .from(changeLog)
      .where(whereClause);

    return rows.map((row) => ({
      entityId: row.entityId,
      observedAt: new Date(row.observedAt),
    }));
  },
};
