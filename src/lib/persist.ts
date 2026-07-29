import { and, eq, or } from "drizzle-orm";
import { db } from "@/db/client";
import type { ProviderName } from "@/db/schema/enums";
import { authors, bookAuthors, books, series } from "@/db/schema/catalog";
import { externalIds } from "@/db/schema/identity";
import { releases, releaseSources } from "@/db/schema/releases";
import { deriveStatus } from "@/resolution/status";
import type { ResolvedBook } from "@/resolution/resolve";

export interface ExternalIdRow {
  entityType: string;
  entityId: string;
  provider: ProviderName;
  externalId: string;
}

export interface ReleaseSourceRow {
  releaseId: string;
  provider: ProviderName;
  sourceUrl?: string;
  valueSeen: string | null;
  trustRank: number;
}

export interface AuthorRow {
  name: string;
  sortName: string;
  position: number;
}

// Higher wins. Mirrors the spec's rule that manual outranks everything.
const TRUST_RANK: Record<ProviderName, number> = {
  manual: 100,
  hardcover: 80,
  wikidata: 70,
  openlibrary: 50,
  google: 30,
};

export function releaseSourceRows(
  releaseId: string,
  valueSeen: string | null,
  sources: { provider: ProviderName; externalId: string; sourceUrl?: string }[],
): ReleaseSourceRow[] {
  return sources.map((source) => ({
    releaseId,
    provider: source.provider,
    sourceUrl: source.sourceUrl,
    valueSeen,
    trustRank: TRUST_RANK[source.provider],
  }));
}

export function authorRows(names: string[]): AuthorRow[] {
  return names
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .map((name, position) => {
      const parts = name.toLowerCase().split(/\s+/);
      const last = parts.length > 1 ? parts[parts.length - 1] : "";
      const rest = parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0];
      return {
        name,
        sortName: last ? `${last} ${rest}` : rest,
        position,
      };
    });
}

async function upsertAuthors(bookId: string, names: string[]): Promise<void> {
  const rows = authorRows(names);
  if (rows.length === 0) return;

  for (const row of rows) {
    const existing = await db
      .select({ id: authors.id })
      .from(authors)
      .where(eq(authors.name, row.name))
      .limit(1);

    const authorId =
      existing[0]?.id ??
      (
        await db
          .insert(authors)
          .values({ name: row.name, sortName: row.sortName })
          .returning({ id: authors.id })
      )[0].id;

    await db
      .insert(bookAuthors)
      .values({ bookId, authorId, position: row.position })
      .onConflictDoNothing();
  }
}

export function externalIdRows(
  entityType: string,
  entityId: string,
  sources: { provider: ProviderName; externalId: string }[],
): ExternalIdRow[] {
  const seen = new Set<string>();
  const rows: ExternalIdRow[] = [];

  for (const source of sources) {
    const key = `${source.provider}:${source.externalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      entityType,
      entityId,
      provider: source.provider,
      externalId: source.externalId,
    });
  }

  return rows;
}

// external_ids is the designed home for provider->entity mapping. Reusing
// it here to detect an already-catalogued book means a second sighting
// enriches the record instead of creating a duplicate book/release chain.
async function findExistingBookId(
  sources: ResolvedBook["sources"],
): Promise<string | null> {
  if (sources.length === 0) return null;

  const matches = sources.map((source) =>
    and(
      eq(externalIds.provider, source.provider),
      eq(externalIds.externalId, source.externalId),
    ),
  );

  const existing = await db
    .select({ entityId: externalIds.entityId })
    .from(externalIds)
    .where(and(eq(externalIds.entityType, "book"), or(...matches)))
    .limit(1);

  return existing[0]?.entityId ?? null;
}

async function upsertSeries(book: ResolvedBook): Promise<string | null> {
  if (!book.seriesName) return null;

  // Insert first and rely on the unique constraint on series.title to
  // absorb a concurrent insert of the same title, then re-select for the
  // id whichever path won. This avoids the select-then-insert race that a
  // plain existence check has.
  await db
    .insert(series)
    .values({ title: book.seriesName, status: "ongoing" })
    .onConflictDoNothing();

  const existing = await db
    .select({ id: series.id })
    .from(series)
    .where(eq(series.title, book.seriesName))
    .limit(1);

  return existing[0]?.id ?? null;
}

export async function persistResolvedBook(
  book: ResolvedBook,
): Promise<{ bookId: string; seriesId: string | null }> {
  const seriesId = await upsertSeries(book);

  const existingBookId = await findExistingBookId(book.sources);

  const bookId =
    existingBookId ??
    (
      await db
        .insert(books)
        .values({
          title: book.title,
          seriesId,
          seriesPosition: book.seriesPosition?.toString(),
          isbn13: book.isbn13,
          coverUrl: book.coverUrl,
          description: book.description,
        })
        .returning({ id: books.id })
    )[0].id;

  await upsertAuthors(bookId, book.authors);

  const rows = externalIdRows("book", bookId, book.sources);
  if (rows.length > 0) {
    await db.insert(externalIds).values(rows).onConflictDoNothing();
  }

  const status = deriveStatus({
    now: new Date(),
    date: book.releaseDate ? new Date(book.releaseDate) : null,
    precision: book.datePrecision ?? null,
    hasBookRecord: true,
    sourceOfficial:
      book.provenance.releaseDate === "hardcover" ||
      book.provenance.releaseDate === "wikidata" ||
      book.provenance.releaseDate === "manual",
    seriesStatus: null,
    lastSeriesReleaseAt: null,
    hiatusThresholdYears: 4,
  });

  // A releases row represents current belief about one book in one region
  // and format. The unique constraint on (book_id, region, format) makes a
  // second persist of the same book refresh that belief rather than add a
  // sibling row, which is what kept fragmenting provenance before.
  const release = await db
    .insert(releases)
    .values({
      bookId,
      region: "US",
      format: "hardcover",
      date: book.releaseDate ?? null,
      datePrecision: book.datePrecision ?? null,
      status,
      confidence: book.confidence,
    })
    .onConflictDoUpdate({
      target: [releases.bookId, releases.region, releases.format],
      set: {
        date: book.releaseDate ?? null,
        datePrecision: book.datePrecision ?? null,
        status,
        confidence: book.confidence,
        updatedAt: new Date(),
      },
    })
    .returning({ id: releases.id });

  // Release sources are current state (which providers back today's
  // belief and what they last reported), not an audit trail: ChangeLog is
  // the designated home for history in this project. So a re-persist
  // clears the prior source rows for this release and re-inserts fresh
  // ones, rather than appending duplicates that would bloat the table and
  // muddy "which providers currently claim this" on every refresh pass.
  await db.delete(releaseSources).where(eq(releaseSources.releaseId, release[0].id));

  const sourceRows = releaseSourceRows(
    release[0].id,
    book.releaseDate ?? null,
    book.sources,
  );
  if (sourceRows.length > 0) {
    await db.insert(releaseSources).values(sourceRows);
  }

  return { bookId, seriesId };
}
