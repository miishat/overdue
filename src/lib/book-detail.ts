import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { authors, bookAuthors, books } from "@/db/schema/catalog";
import { changeLog } from "@/db/schema/changelog";
import { releases, releaseSources } from "@/db/schema/releases";
import type { DatePrecision, ProviderName, ReleaseStatus } from "@/db/schema/enums";
import { dateChangesFrom, type ChangeLogRow, type DateChange } from "./changes";

export interface ReleaseSourceRow {
  provider: ProviderName;
  sourceUrl: string | null;
  lastVerifiedAt: Date;
}

export interface ReleaseRow {
  id: string;
  region: string;
  format: string;
  date: Date | null;
  precision: DatePrecision | null;
  status: ReleaseStatus;
  sources: ReleaseSourceRow[];
}

export interface BookDetail {
  id: string;
  title: string;
  coverUrl: string | null;
  description: string | null;
  authorNames: string[];
  releases: ReleaseRow[];
  changes: DateChange[];
}

export interface BookDetailDataSource {
  bookById(bookId: string): Promise<BookDetail | null>;
}

export async function loadBookDetail(
  source: BookDetailDataSource,
  bookId: string,
): Promise<BookDetail | null> {
  return source.bookById(bookId);
}

/**
 * Live BookDetailDataSource backed by Drizzle/Postgres.
 *
 * No user scoping: like drizzleSeriesDetailSource (src/lib/series-detail.ts),
 * this deliberately does not check that the current user tracks the
 * requested bookId, so any valid book id in the URL renders. That is fine
 * today because v1 has no real authentication (see getCurrentUserId in
 * src/lib/current-user.ts, a hardcoded single user) and the whole
 * deployment sits behind proxy.ts's shared secret. It stops being fine the
 * moment real auth is added, since at that point one user could reach
 * another user's book data by guessing a book id. When that happens, thread
 * scoping through here from getCurrentUserId, the single identity choke
 * point.
 */
export const drizzleBookDetailSource: BookDetailDataSource = {
  async bookById(bookId) {
    const bookRows = await db
      .select({
        id: books.id,
        title: books.title,
        coverUrl: books.coverUrl,
        description: books.description,
      })
      .from(books)
      .where(eq(books.id, bookId));

    const book = bookRows[0];
    if (!book) return null;

    const [authorRows, releaseRows, changeRows] = await Promise.all([
      db
        .select({ name: authors.name, position: bookAuthors.position })
        .from(bookAuthors)
        .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
        .where(eq(bookAuthors.bookId, bookId))
        .orderBy(bookAuthors.position),
      db
        .select({
          id: releases.id,
          region: releases.region,
          format: releases.format,
          date: releases.date,
          precision: releases.datePrecision,
          status: releases.status,
        })
        .from(releases)
        .where(eq(releases.bookId, bookId)),
      db
        .select({
          id: changeLog.id,
          entityType: changeLog.entityType,
          entityId: changeLog.entityId,
          field: changeLog.field,
          oldValue: changeLog.oldValue,
          newValue: changeLog.newValue,
          provider: changeLog.provider,
          observedAt: changeLog.observedAt,
        })
        .from(changeLog)
        .where(
          and(eq(changeLog.entityType, "book"), eq(changeLog.entityId, bookId)),
        ),
    ]);

    const releaseIds = releaseRows.map((row) => row.id);
    const sourceRows =
      releaseIds.length === 0
        ? []
        : await db
            .select({
              releaseId: releaseSources.releaseId,
              provider: releaseSources.provider,
              sourceUrl: releaseSources.sourceUrl,
              lastVerifiedAt: releaseSources.lastVerifiedAt,
            })
            .from(releaseSources)
            .where(inArray(releaseSources.releaseId, releaseIds));

    const sourcesByRelease = new Map<string, ReleaseSourceRow[]>();
    for (const row of sourceRows) {
      const list = sourcesByRelease.get(row.releaseId) ?? [];
      list.push({
        provider: row.provider,
        sourceUrl: row.sourceUrl,
        lastVerifiedAt: row.lastVerifiedAt,
      });
      sourcesByRelease.set(row.releaseId, list);
    }

    const changeLogRows: ChangeLogRow[] = changeRows.map((row) => ({
      id: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      field: row.field,
      oldValue: row.oldValue,
      newValue: row.newValue,
      provider: row.provider,
      observedAt: row.observedAt,
    }));

    return {
      id: book.id,
      title: book.title,
      coverUrl: book.coverUrl,
      description: book.description,
      authorNames: authorRows.map((row) => row.name),
      releases: releaseRows.map((row) => ({
        id: row.id,
        region: row.region,
        format: row.format,
        date: row.date ? new Date(row.date) : null,
        precision: row.precision,
        status: row.status,
        sources: sourcesByRelease.get(row.id) ?? [],
      })),
      changes: dateChangesFrom(changeLogRows),
    };
  },
};
