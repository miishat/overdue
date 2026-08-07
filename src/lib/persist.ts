import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db/client";
import type { DatePrecision, ProviderName } from "@/db/schema/enums";
import { authors, bookAuthors, books, series } from "@/db/schema/catalog";
import { externalIds } from "@/db/schema/identity";
import { releases, releaseSources } from "@/db/schema/releases";
import { OFFICIAL_PROVIDERS } from "@/providers/registry";
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
export const TRUST_RANK: Record<ProviderName, number> = {
  manual: 100,
  hardcover: 80,
  wikidata: 70,
  openlibrary: 50,
  google: 30,
};

export function releaseSourceRows(
  releaseId: string,
  sources: {
    provider: ProviderName;
    externalId: string;
    sourceUrl?: string;
    releaseDate?: string | null;
  }[],
): ReleaseSourceRow[] {
  return sources.map((source) => ({
    releaseId,
    provider: source.provider,
    sourceUrl: source.sourceUrl,
    valueSeen: source.releaseDate ?? null,
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

// Three statements total regardless of author count, replacing a former
// per-author loop (select, conditional insert, bookAuthors insert; 3 * N
// statements for N authors). authors.name has no unique constraint and no
// index (confirmed empty uniqueConstraints/indexes for authors in both
// src/db/schema/catalog.ts and drizzle/meta/0006_snapshot.json), so
// onConflictDoNothing on authors would have no conflict target: adding one
// is a schema change with migration implications and a real risk of
// colliding with existing duplicate rows, out of scope here. That also
// means this keeps the same check-then-insert race the original loop
// already had: two concurrent persists can both see a name as missing and
// both insert it, since nothing at the database level forbids a duplicate
// authors.name. Not a regression introduced by batching; only a unique
// constraint on authors.name would actually close it.
async function upsertAuthors(bookId: string, names: string[]): Promise<void> {
  const rows = authorRows(names);
  if (rows.length === 0) return;

  const distinctNames = [...new Set(rows.map((row) => row.name))];
  const existing = await db
    .select({ id: authors.id, name: authors.name })
    .from(authors)
    .where(inArray(authors.name, distinctNames));

  const idByName = new Map(existing.map((row) => [row.name, row.id]));

  // Dedupe by name (not just by row) before inserting: a name already
  // missing on two `rows` entries (a book listing the same author twice)
  // must still resolve to one author id, matching what the original
  // select-then-insert-then-select loop did via read-after-write.
  const missingByName = new Map(
    rows.filter((row) => !idByName.has(row.name)).map((row) => [row.name, row]),
  );

  if (missingByName.size > 0) {
    const inserted = await db
      .insert(authors)
      .values(
        [...missingByName.values()].map((row) => ({
          name: row.name,
          sortName: row.sortName,
        })),
      )
      .returning({ id: authors.id, name: authors.name });
    for (const row of inserted) {
      idByName.set(row.name, row.id);
    }
  }

  const joinRows: { bookId: string; authorId: string; position: number }[] = [];
  for (const row of rows) {
    const authorId = idByName.get(row.name);
    if (authorId === undefined) {
      throw new Error(`upsertAuthors: no author id resolved for "${row.name}"`);
    }
    joinRows.push({ bookId, authorId, position: row.position });
  }

  await db.insert(bookAuthors).values(joinRows).onConflictDoNothing();
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

// A book's seriesExternalId is only trustworthy alongside the provider that
// supplied it (recorded in provenance.seriesExternalId by the trust
// matrix). Without that provider we cannot form a (provider, externalId)
// pair to look up, so the external-id path is skipped entirely and title
// matching is used instead.
async function findSeriesIdByExternalId(book: ResolvedBook): Promise<string | null> {
  const provider = book.provenance.seriesExternalId;
  if (!book.seriesExternalId || !provider) return null;

  const existing = await db
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

  return existing[0]?.entityId ?? null;
}

async function upsertSeries(book: ResolvedBook): Promise<string | null> {
  const byExternalId = await findSeriesIdByExternalId(book);
  if (byExternalId) return byExternalId;

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

  const seriesId = existing[0]?.id ?? null;

  // Record the external id now so the next sighting of this series (even
  // under a different title) resolves by id instead of by title.
  const provider = book.provenance.seriesExternalId;
  if (seriesId && book.seriesExternalId && provider) {
    await db
      .insert(externalIds)
      .values([
        {
          entityType: "series",
          entityId: seriesId,
          provider,
          externalId: book.seriesExternalId,
        },
      ])
      .onConflictDoNothing();
  }

  return seriesId;
}

/** What we believe the release date is, and whether a source said so. */
export interface DateBelief {
  date: string | null;
  precision: DatePrecision | null;
  /**
   * True when the resolution made a claim about the date, INCLUDING an
   * explicit withdrawal. False means nothing was reported and the stored
   * belief was carried forward untouched.
   */
  asserted: boolean;
}

/**
 * Decides what the release date should become, given what is stored and what
 * the resolution claims.
 *
 * WHY THIS EXISTS. A refresh that reached only Open Library, which answered
 * with the book but WITHOUT a release date, wiped the real release dates of
 * every book in the developer's library: five known-good dates replaced with
 * null and their status collapsed to RUMORED. The old rule here was
 * `date: book.releaseDate ?? null` on both the insert and the conflict update,
 * i.e. an unconditional overwrite, while title, coverUrl, isbn13, description
 * and seriesPosition on the same row were already fill-only. That asymmetry
 * was the bug.
 *
 * A provider that answers but omits a field is NOT asserting the field is
 * empty; it is simply not reporting it. So an ABSENT date (undefined) leaves
 * the stored date exactly as it is, and only a value a source actually
 * asserted may overwrite it.
 *
 * The date and its precision move as ONE unit. Keeping a stored 1966-01-01
 * next to a precision from a resolution that never mentioned that date would
 * mislabel the very value being preserved.
 *
 * An asserted null still clears the date, so an authoritative withdrawal is
 * still representable and buildDateChangeAlert's withdrawal copy is still
 * reachable. No adapter can produce that today (see ResolvedBook.releaseDate),
 * which means in practice this fix converts every provider-driven withdrawal
 * into "keep what we have" until the ProviderBook contract can distinguish the
 * two. That is the correct direction to fail in: a stale date is visible and
 * correctable, a silently deleted one is neither.
 */
export function resolveDateBelief(
  stored: { date: string | null; datePrecision: DatePrecision | null } | null,
  resolved: Pick<ResolvedBook, "releaseDate" | "datePrecision">,
): DateBelief {
  if (resolved.releaseDate === undefined && stored) {
    return { date: stored.date, precision: stored.datePrecision, asserted: false };
  }
  return {
    date: resolved.releaseDate ?? null,
    precision: resolved.datePrecision ?? null,
    asserted: true,
  };
}

/**
 * Builds (without executing) the pre-write read of the belief a persist is
 * about to replace. Exported separately from `persistResolvedBook`, following
 * the same pattern as `buildUpsertStatement` in src/lib/push/subscriptions.ts,
 * so a test can assert on the exact statement via `.toSQL()` (which fields it
 * filters on) without needing a database connection, rather than trusting a
 * hand-written copy of the where clause that could drift from the real query.
 */
export function buildStoredReleaseSelectStatement(bookId: string) {
  return db
    .select({
      date: releases.date,
      datePrecision: releases.datePrecision,
      confidence: releases.confidence,
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
}

export async function persistResolvedBook(
  book: ResolvedBook,
): Promise<{ bookId: string; seriesId: string | null }> {
  const seriesId = await upsertSeries(book);

  const existingBookId = await findExistingBookId(book.sources);

  let bookId: string;
  if (existingBookId) {
    bookId = existingBookId;

    // A second sighting enriches the record: only overwrite a column when
    // the incoming value is present, so a provider that omits a field (or
    // simply doesn't carry it) cannot blank data another provider supplied.
    // seriesId is the exception worth calling out: it is only filled in
    // when the book was not already linked to a series, never overwritten
    // once set.
    const existingSeries = await db
      .select({ seriesId: books.seriesId })
      .from(books)
      .where(eq(books.id, existingBookId))
      .limit(1);
    const currentSeriesId = existingSeries[0]?.seriesId ?? null;

    const updateSet: Partial<typeof books.$inferInsert> = {};
    if (book.title) updateSet.title = book.title;
    if (book.isbn13) updateSet.isbn13 = book.isbn13;
    if (book.coverUrl) updateSet.coverUrl = book.coverUrl;
    if (book.description) updateSet.description = book.description;
    if (book.seriesPosition !== undefined) {
      updateSet.seriesPosition = book.seriesPosition.toString();
    }
    if (seriesId && !currentSeriesId) updateSet.seriesId = seriesId;

    if (Object.keys(updateSet).length > 0) {
      await db.update(books).set(updateSet).where(eq(books.id, existingBookId));
    }
  } else {
    bookId = (
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
  }

  await upsertAuthors(bookId, book.authors);

  const rows = externalIdRows("book", bookId, book.sources);
  if (rows.length > 0) {
    await db.insert(externalIds).values(rows).onConflictDoNothing();
  }

  // Whether the record itself is official, not merely whether an official
  // provider happened to be the one that supplied the release date. A
  // manual entry has no adapter-level release date claim until the user
  // adds one, but it is still the user's own record and should read as
  // ANNOUNCED rather than RUMORED. OFFICIAL_PROVIDERS mirrors each
  // adapter's own `official` flag (plus manual), so this can't drift from
  // a second, hand-maintained list of "official" provider names.
  const sourceOfficial =
    book.sources.some((source) => OFFICIAL_PROVIDERS[source.provider]) ||
    (book.provenance.releaseDate
      ? OFFICIAL_PROVIDERS[book.provenance.releaseDate]
      : false);

  // Read the belief this write is about to replace, so an absent date can be
  // carried forward rather than overwritten. See resolveDateBelief.
  const storedRelease = (await buildStoredReleaseSelectStatement(bookId))[0];

  const belief = resolveDateBelief(storedRelease ?? null, book);

  // confidence scores belief in the DATE, so it travels with the date. A
  // resolution that reported no date scores 40 by construction, and writing
  // that next to a date it never saw would understate a date another provider
  // did assert.
  //
  // This also covers a manual re-submit that carries confidence: 100 by
  // construction (see /api/manual) but did not itself assert a date: when
  // belief.asserted is false the write keeps storedRelease.confidence rather
  // than stamping the manual submission's own 100 over a lower score another
  // provider earned. See "carries the stored confidence forward" below.
  const confidence =
    belief.asserted || !storedRelease ? book.confidence : storedRelease.confidence;

  const status = deriveStatus({
    now: new Date(),
    date: belief.date ? new Date(belief.date) : null,
    precision: belief.precision,
    hasBookRecord: true,
    sourceOfficial,
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
      date: belief.date,
      datePrecision: belief.precision,
      status,
      confidence,
    })
    .onConflictDoUpdate({
      target: [releases.bookId, releases.region, releases.format],
      set: {
        date: belief.date,
        datePrecision: belief.precision,
        status,
        confidence,
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
  //
  // CHOSEN TRADE-OFF: when belief.asserted is false (this persist preserved
  // a stored date because nothing reported one), the re-inserted rows below
  // still come from book.sources, i.e. what THIS resolution saw, not from
  // whatever source originally justified the preserved date. So a preserved
  // date can end up next to a release_sources row with a null valueSeen,
  // and the row that actually backs the surviving date is not retained.
  // This is accepted rather than fixed: release_sources already documents
  // itself as current-state-not-audit-trail one paragraph up, the date
  // itself is never lost (that is the whole point of resolveDateBelief),
  // and change_log is where an investigator should look for "what did we
  // last see and when", not release_sources.
  // A failure between the delete and the insert below would leave the
  // release with zero source rows: exactly the case the two paragraphs
  // above assume can't happen ("the row that actually backs the surviving
  // date is not retained" is an accepted trade-off, but a release with NO
  // source rows at all is not that trade-off, it's data loss). neon-http
  // has no interactive transactions (db.transaction needs a session a
  // stateless HTTP connection doesn't have), but it does support
  // non-interactive batched transactions via db.batch, which sends every
  // statement in one request and commits or rolls back as a unit. So the
  // delete and the (possibly absent) insert are issued together rather
  // than as two separately awaited statements.
  const deleteReleaseSources = db
    .delete(releaseSources)
    .where(eq(releaseSources.releaseId, release[0].id));

  const sourceRows = releaseSourceRows(release[0].id, book.sources);
  if (sourceRows.length > 0) {
    await db.batch([deleteReleaseSources, db.insert(releaseSources).values(sourceRows)]);
  } else {
    // db.batch's type requires a non-empty tuple, so this can't just pass
    // an empty array alongside the delete. A batch of one statement is
    // still correct and still atomic: there's nothing to insert.
    await db.batch([deleteReleaseSources]);
  }

  return { bookId, seriesId };
}
