import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { books, series } from "@/db/schema/catalog";
import { changeLog } from "@/db/schema/changelog";
import { externalIds } from "@/db/schema/identity";
import { notificationQueue, pushSubscriptions } from "@/db/schema/push";
import { releases, releaseSources } from "@/db/schema/releases";
import { tracks } from "@/db/schema/tracking";
import { LOCAL_USER_ID } from "@/lib/current-user";
import type { MetadataProvider } from "@/providers/types";

/**
 * Fixed, hardcoded ids for the end-to-end fixture. Never generated at
 * runtime, so `clearSeeded` can delete exactly and only these rows from the
 * developer's live database.
 */

// Standalone books (no series), one per directly-dated / undated state.
const BOOK_DATED_ID = "eeeeeeee-0000-4000-8000-000000000001";
const BOOK_ESTIMATED_ID = "eeeeeeee-0000-4000-8000-000000000002";
const BOOK_ANNOUNCED_ID = "eeeeeeee-0000-4000-8000-000000000003";
const BOOK_RUMORED_ID = "eeeeeeee-0000-4000-8000-000000000004";

// The hiatus series' one real, past book. It supplies both the RELEASED
// assertion and the past lastSeriesReleaseAt that lets the HIATUS entry
// synthesise for the same series.
const BOOK_HIATUS_ANCHOR_ID = "eeeeeeee-0000-4000-8000-000000000005";

const RELEASE_DATED_ID = "eeeeeeee-0000-4000-8000-000000000011";
const RELEASE_ESTIMATED_ID = "eeeeeeee-0000-4000-8000-000000000012";
const RELEASE_ANNOUNCED_ID = "eeeeeeee-0000-4000-8000-000000000013";
const RELEASE_RUMORED_ID = "eeeeeeee-0000-4000-8000-000000000014";
const RELEASE_HIATUS_ANCHOR_ID = "eeeeeeee-0000-4000-8000-000000000015";

const RELEASE_SOURCE_ANNOUNCED_ID = "eeeeeeee-0000-4000-8000-000000000021";
const RELEASE_SOURCE_RUMORED_ID = "eeeeeeee-0000-4000-8000-000000000022";

const SERIES_HIATUS_ID = "eeeeeeee-0000-4000-8000-000000000031";
// Tracked, has no book rows at all, so it synthesises EXPECTED.
const SERIES_EXPECTED_ID = "eeeeeeee-0000-4000-8000-000000000032";
// Tracked and complete, so it must never contribute anything to the shelf.
const SERIES_COMPLETE_ID = "eeeeeeee-0000-4000-8000-000000000033";

const TRACK_DATED_ID = "eeeeeeee-0000-4000-8000-000000000041";
const TRACK_ESTIMATED_ID = "eeeeeeee-0000-4000-8000-000000000042";
const TRACK_ANNOUNCED_ID = "eeeeeeee-0000-4000-8000-000000000043";
const TRACK_RUMORED_ID = "eeeeeeee-0000-4000-8000-000000000044";
const TRACK_HIATUS_SERIES_ID = "eeeeeeee-0000-4000-8000-000000000045";
const TRACK_EXPECTED_SERIES_ID = "eeeeeeee-0000-4000-8000-000000000046";
const TRACK_COMPLETE_SERIES_ID = "eeeeeeee-0000-4000-8000-000000000047";

const ALL_TRACK_IDS = [
  TRACK_DATED_ID,
  TRACK_ESTIMATED_ID,
  TRACK_ANNOUNCED_ID,
  TRACK_RUMORED_ID,
  TRACK_HIATUS_SERIES_ID,
  TRACK_EXPECTED_SERIES_ID,
  TRACK_COMPLETE_SERIES_ID,
];

const ALL_RELEASE_SOURCE_IDS = [
  RELEASE_SOURCE_ANNOUNCED_ID,
  RELEASE_SOURCE_RUMORED_ID,
];

const ALL_RELEASE_IDS = [
  RELEASE_DATED_ID,
  RELEASE_ESTIMATED_ID,
  RELEASE_ANNOUNCED_ID,
  RELEASE_RUMORED_ID,
  RELEASE_HIATUS_ANCHOR_ID,
];

const ALL_BOOK_IDS = [
  BOOK_DATED_ID,
  BOOK_ESTIMATED_ID,
  BOOK_ANNOUNCED_ID,
  BOOK_RUMORED_ID,
  BOOK_HIATUS_ANCHOR_ID,
];

const ALL_SERIES_IDS = [
  SERIES_HIATUS_ID,
  SERIES_EXPECTED_ID,
  SERIES_COMPLETE_ID,
];

/**
 * Task 17 fixture: one tracked book whose refetched snapshot genuinely
 * differs from what is stored, so a refresh run produces a real diff written
 * by the real code against the real database.
 *
 * The book is seeded with a deliberately wrong release_date ("1900-01-01",
 * precision "year") and one external_ids row naming a provider id that
 * belongs to nothing real. refresh.spec.ts drives the run through
 * createDrizzleRefreshPort with REFRESH_FIXTURE_REGISTRY below, so the
 * "external provider moved the date underneath us" case is produced by a
 * fixture adapter rather than by a live HTTP call.
 *
 * WHY NOT A LIVE PROVIDER. An earlier version of this fixture pointed at
 * Wikidata's real entity for "Pride and Prejudice" and let a refresh call
 * query.wikidata.org for real. That put a live provider call on the CI path
 * (.github/workflows/ci.yml runs pnpm test:e2e on every push and PR), which
 * the milestone's Global Constraint forbids outright, and which this
 * codebase already rules out in its own words: vitest.config.ts quarantines
 * *.live.test.ts behind pnpm test:live precisely because those files "must
 * never run as part of the default suite or in CI". The literal
 * "release_date" reaching Postgres and being read back is proved instead by
 * seedReleaseDateHistory below plus the reader assertion in refresh.spec.ts,
 * neither of which needs a provider at all.
 *
 * The external id is deliberately unresolvable by any real adapter, so even
 * a future caller that hands this fixture the production registry by mistake
 * gets nothing back rather than silently reaching the network for a real
 * entity.
 */
const REFRESH_BOOK_ID = "00000000-1111-4000-8000-000000000001";
const REFRESH_RELEASE_ID = "eeeeeeee-1111-4000-8000-000000000002";
const REFRESH_EXTERNAL_ID_ROW_ID = "eeeeeeee-1111-4000-8000-000000000003";
const REFRESH_RELEASE_SOURCE_ID = "eeeeeeee-1111-4000-8000-000000000004";
const REFRESH_TRACK_ID = "eeeeeeee-1111-4000-8000-000000000005";

/**
 * The (provider, externalId) pair that maps this fixture book in
 * external_ids. It must stay present and stay pointing at REFRESH_BOOK_ID:
 * persistResolvedBook's findExistingBookId matches on exactly this pair, and
 * without it a write-back would insert a brand new book row instead of
 * updating the fixture's.
 */
const REFRESH_EXTERNAL_ID = "E2E-FIXTURE-NOT-A-REAL-WIKIDATA-ENTITY";

const REFRESH_SEEDED_DATE = "1900-01-01";

/**
 * What the fixture adapter reports. Computed from the current year rather
 * than hardcoded so the corrected date stays comfortably in the future and
 * the derived status never flips as real time passes, and computed ONCE at
 * module load so both runs in the idempotence test see the same value.
 */
const REFRESH_CORRECTED_DATE = `${new Date().getUTCFullYear() + 2}-06-15`;

export const REFRESH_FIXTURE = {
  bookId: REFRESH_BOOK_ID,
  seededTitle: "E2E Refresh Target Book",
  seededDate: REFRESH_SEEDED_DATE,
  correctedDate: REFRESH_CORRECTED_DATE,
  externalId: REFRESH_EXTERNAL_ID,
};

function unsupported(method: string): never {
  throw new Error(
    `refresh fixture adapter: ${method} must never be called by a refresh run`,
  );
}

/**
 * A MetadataProvider that answers from memory and never opens a socket.
 *
 * It carries the "wikidata" name because that is the provider recorded on
 * the fixture's external_ids and release_sources rows, and fetchKnownSources
 * looks an adapter up by name. Every method other than getBook throws: a
 * refresh must only ever call getBook, and a silent empty answer from the
 * others would hide a change in that contract.
 *
 * `authors` is deliberately empty. persistResolvedBook's upsertAuthors
 * inserts into `authors`, which has no foreign key to `books`, so any author
 * name here would leave a row that clearSeeded could not remove without
 * deleting by a predicate that might match one of the developer's real
 * authors. Emitting none means none is created.
 */
export const REFRESH_FIXTURE_PROVIDER: MetadataProvider = {
  name: "wikidata",
  official: true,
  async searchBooks() {
    unsupported("searchBooks");
  },
  async getBook(externalId) {
    if (externalId !== REFRESH_EXTERNAL_ID) return null;
    return {
      provider: "wikidata",
      externalId: REFRESH_EXTERNAL_ID,
      // Identical to the seeded title on purpose, so the only fields the
      // diff can report are the date fields and the status they derive.
      title: REFRESH_FIXTURE.seededTitle,
      authors: [],
      releaseDate: REFRESH_CORRECTED_DATE,
      datePrecision: "day",
      sourceUrl: "https://e2e.overdue.test/fixture-entity",
    };
  },
  async getSeries() {
    unsupported("getSeries");
  },
  async getSeriesEntries() {
    unsupported("getSeriesEntries");
  },
};

/** The whole adapter set a fixture-scoped refresh run is allowed to see. */
export const REFRESH_FIXTURE_REGISTRY: MetadataProvider[] = [
  REFRESH_FIXTURE_PROVIDER,
];

/**
 * Task 17 fixture: two push subscriptions covering the health states
 * Settings must render distinctly. Endpoints are fixed and distinctive
 * (never a real browser endpoint) so `SubscriptionStore.upsert`'s unique
 * constraint on `endpoint` can never collide with the developer's own
 * devices.
 */
const SETTINGS_SUB_HEALTHY_ID = "eeeeeeee-2222-4000-8000-000000000001";
const SETTINGS_SUB_FAILING_ID = "eeeeeeee-2222-4000-8000-000000000002";

export const SETTINGS_FIXTURE = {
  healthyId: SETTINGS_SUB_HEALTHY_ID,
  healthyEndpoint: "https://e2e.overdue.test/push/healthy-endpoint",
  healthyUserAgent: "E2E Healthy Device",
  failingId: SETTINGS_SUB_FAILING_ID,
  failingEndpoint: "https://e2e.overdue.test/push/failing-endpoint",
  failingUserAgent: "E2E Failing Device",
  failingCount: 3,
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function yearsFromNow(years: number): Date {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

/**
 * Deletes exactly and only the fixed ids declared above, in FK-safe order
 * (tracks and release_sources first, then releases, then books, then
 * series). No WHERE clause here is ever broader than an explicit id list;
 * nothing is truncated and nothing is deleted by title, timestamp, or any
 * other heuristic.
 */
export async function clearSeeded(): Promise<void> {
  await db.delete(tracks).where(inArray(tracks.id, [...ALL_TRACK_IDS, REFRESH_TRACK_ID]));
  await db
    .delete(releaseSources)
    .where(inArray(releaseSources.id, [...ALL_RELEASE_SOURCE_IDS, REFRESH_RELEASE_SOURCE_ID]));
  // persistResolvedBook DELETEs and re-INSERTs a release's source rows, and
  // the replacements get server generated ids, so the fixed id above no
  // longer matches them after a refresh has committed. Scoping this second
  // delete by release id is exactly as safe: REFRESH_RELEASE_ID is one of
  // our own hardcoded ids and no other release can ever equal it.
  await db
    .delete(releaseSources)
    .where(eq(releaseSources.releaseId, REFRESH_RELEASE_ID));
  await db
    .delete(releases)
    .where(inArray(releases.id, [...ALL_RELEASE_IDS, REFRESH_RELEASE_ID]));
  // Same reasoning again: persistResolvedBook inserts external_ids rows with
  // server generated ids for every source it commits, so the fixed row id
  // is not enough on its own. entity_id is one of our hardcoded book ids.
  await db
    .delete(externalIds)
    .where(inArray(externalIds.id, [REFRESH_EXTERNAL_ID_ROW_ID]));
  await db.delete(externalIds).where(eq(externalIds.entityId, REFRESH_BOOK_ID));
  // book_authors would be cleaned here too, but the fixture cannot create
  // one: REFRESH_FIXTURE_PROVIDER reports no authors, precisely so that
  // upsertAuthors never inserts into `authors`, which has no foreign key to
  // `books` and therefore could not be cleaned up by any id this file owns.
  // Nothing in this function deletes an author row, by id or by predicate.
  await db.delete(books).where(inArray(books.id, [...ALL_BOOK_IDS, REFRESH_BOOK_ID]));
  await db.delete(series).where(inArray(series.id, ALL_SERIES_IDS));

  // change_log has no fixed id of its own (every row's id is server
  // generated), so this is scoped by entity_id instead, which is exactly as
  // safe: REFRESH_BOOK_ID is one of our own hardcoded ids above, and no
  // change_log row for any other book can ever match it. This never touches
  // a row for a book the developer actually tracks.
  await db.delete(changeLog).where(eq(changeLog.entityId, REFRESH_BOOK_ID));

  // Same reasoning for notification_queue: rows get a server generated id,
  // so cleanup is scoped by the bookId embedded in the row's own jsonb
  // payload, which is always one of our hardcoded ids, never a real one.
  await db
    .delete(notificationQueue)
    .where(sql`${notificationQueue.payload}->>'bookId' = ${REFRESH_BOOK_ID}`);

  await db
    .delete(pushSubscriptions)
    .where(inArray(pushSubscriptions.id, [SETTINGS_SUB_HEALTHY_ID, SETTINGS_SUB_FAILING_ID]));
  // The upsert test in refresh.spec.ts calls drizzleSubscriptionStore.upsert,
  // which generates its own id. If the upsert's conflict target ever stopped
  // matching the unique index (exactly the defect that test exists to catch)
  // the call would INSERT rather than update, and the id list above would not
  // reach the new row. These two endpoints are hardcoded above and are not
  // valid push endpoints for any real device, so deleting by them cannot
  // match one of the developer's own subscriptions.
  await db
    .delete(pushSubscriptions)
    .where(
      inArray(pushSubscriptions.endpoint, [
        SETTINGS_FIXTURE.healthyEndpoint,
        SETTINGS_FIXTURE.failingEndpoint,
      ]),
    );
}

/**
 * Seeds one row shape per reachable release state (RELEASED, DATED,
 * ESTIMATED, ANNOUNCED, RUMORED are real rows; EXPECTED and HIATUS are
 * synthesised at read time from the series rows here). COMPLETE is seeded
 * too, as a series that must contribute nothing.
 */
export async function seedAllStates(): Promise<void> {
  await db.insert(series).values([
    { id: SERIES_HIATUS_ID, title: "E2E Hiatus Series", status: "ongoing" },
    { id: SERIES_EXPECTED_ID, title: "E2E Expected Series", status: "ongoing" },
    { id: SERIES_COMPLETE_ID, title: "E2E Complete Series", status: "complete" },
  ]);

  await db.insert(books).values([
    {
      id: BOOK_DATED_ID,
      title: "E2E Dated Book",
      seriesId: null,
      seriesPosition: null,
    },
    {
      id: BOOK_ESTIMATED_ID,
      title: "E2E Estimated Book",
      seriesId: null,
      seriesPosition: null,
    },
    {
      id: BOOK_ANNOUNCED_ID,
      title: "E2E Announced Book",
      seriesId: null,
      seriesPosition: null,
    },
    {
      id: BOOK_RUMORED_ID,
      title: "E2E Rumored Book",
      seriesId: null,
      seriesPosition: null,
    },
    {
      id: BOOK_HIATUS_ANCHOR_ID,
      title: "E2E Hiatus Series Book 1",
      seriesId: SERIES_HIATUS_ID,
      seriesPosition: "1",
    },
  ]);

  await db.insert(releases).values([
    {
      id: RELEASE_DATED_ID,
      bookId: BOOK_DATED_ID,
      region: "US",
      format: "hardcover",
      date: isoDate(daysFromNow(20)),
      datePrecision: "day",
      status: "DATED",
    },
    {
      id: RELEASE_ESTIMATED_ID,
      bookId: BOOK_ESTIMATED_ID,
      region: "US",
      format: "hardcover",
      date: isoDate(daysFromNow(120)),
      datePrecision: "month",
      status: "ESTIMATED",
    },
    {
      id: RELEASE_ANNOUNCED_ID,
      bookId: BOOK_ANNOUNCED_ID,
      region: "US",
      format: "hardcover",
      date: null,
      datePrecision: null,
      status: "ANNOUNCED",
    },
    {
      id: RELEASE_RUMORED_ID,
      bookId: BOOK_RUMORED_ID,
      region: "US",
      format: "hardcover",
      date: null,
      datePrecision: null,
      status: "RUMORED",
    },
    {
      id: RELEASE_HIATUS_ANCHOR_ID,
      bookId: BOOK_HIATUS_ANCHOR_ID,
      region: "US",
      format: "hardcover",
      // Six years in the past, safely past the four year hiatus threshold,
      // and also the row that makes this book itself render as RELEASED.
      date: isoDate(yearsFromNow(-6)),
      datePrecision: "day",
      status: "RELEASED",
    },
  ]);

  // ANNOUNCED needs an official provider source; RUMORED needs a non-official
  // one. OFFICIAL_PROVIDERS in src/providers/registry.ts is the authority:
  // hardcover, wikidata, and manual are official, google and openlibrary
  // are not.
  await db.insert(releaseSources).values([
    {
      id: RELEASE_SOURCE_ANNOUNCED_ID,
      releaseId: RELEASE_ANNOUNCED_ID,
      provider: "hardcover",
    },
    {
      id: RELEASE_SOURCE_RUMORED_ID,
      releaseId: RELEASE_RUMORED_ID,
      provider: "google",
    },
  ]);

  await db.insert(tracks).values([
    { id: TRACK_DATED_ID, userId: LOCAL_USER_ID, bookId: BOOK_DATED_ID, seriesId: null },
    { id: TRACK_ESTIMATED_ID, userId: LOCAL_USER_ID, bookId: BOOK_ESTIMATED_ID, seriesId: null },
    { id: TRACK_ANNOUNCED_ID, userId: LOCAL_USER_ID, bookId: BOOK_ANNOUNCED_ID, seriesId: null },
    { id: TRACK_RUMORED_ID, userId: LOCAL_USER_ID, bookId: BOOK_RUMORED_ID, seriesId: null },
    { id: TRACK_HIATUS_SERIES_ID, userId: LOCAL_USER_ID, bookId: null, seriesId: SERIES_HIATUS_ID },
    { id: TRACK_EXPECTED_SERIES_ID, userId: LOCAL_USER_ID, bookId: null, seriesId: SERIES_EXPECTED_ID },
    { id: TRACK_COMPLETE_SERIES_ID, userId: LOCAL_USER_ID, bookId: null, seriesId: SERIES_COMPLETE_ID },
  ]);
}

/**
 * Seeds the Task 17 refresh fixture: a tracked book whose stored release
 * date is deliberately wrong ("1900-01-01") and whose only known external
 * source is the fixture adapter's unresolvable id. A refresh run driven with
 * REFRESH_FIXTURE_REGISTRY corrects the date, producing a genuine change_log
 * row written by the real diff, the real port and the real database, rather
 * than one written by the test itself. See REFRESH_FIXTURE's comment above,
 * and refresh.spec.ts for the assertions built on it.
 */
export async function seedRefreshFixture(): Promise<void> {
  await db.insert(books).values({
    id: REFRESH_BOOK_ID,
    title: REFRESH_FIXTURE.seededTitle,
    seriesId: null,
    seriesPosition: null,
  });

  await db.insert(releases).values({
    id: REFRESH_RELEASE_ID,
    bookId: REFRESH_BOOK_ID,
    region: "US",
    format: "hardcover",
    date: REFRESH_SEEDED_DATE,
    datePrecision: "year",
    status: "RELEASED",
  });

  await db.insert(releaseSources).values({
    id: REFRESH_RELEASE_SOURCE_ID,
    releaseId: REFRESH_RELEASE_ID,
    provider: "wikidata",
    valueSeen: REFRESH_SEEDED_DATE,
    trustRank: 70,
  });

  // The (provider, externalId) pair the port's loadKnownSources reads to
  // decide which adapters to re-fetch, and the row persistResolvedBook's
  // findExistingBookId matches on so the write-back updates this book
  // rather than inserting a new one. The external id resolves to nothing in
  // any real provider; only REFRESH_FIXTURE_PROVIDER answers for it.
  await db.insert(externalIds).values({
    id: REFRESH_EXTERNAL_ID_ROW_ID,
    entityType: "book",
    entityId: REFRESH_BOOK_ID,
    provider: "wikidata",
    externalId: REFRESH_EXTERNAL_ID,
  });

  await db.insert(tracks).values({
    id: REFRESH_TRACK_ID,
    userId: LOCAL_USER_ID,
    bookId: REFRESH_BOOK_ID,
    seriesId: null,
  });
}

/**
 * Seeds the Task 17 Settings fixture: one subscription with a recent
 * success (healthy) and one with repeated failures and no success at all
 * (failing). Timestamps are computed from `now` rather than hardcoded, so
 * the fixture stays "recent" and "failing" no matter when the suite runs.
 */
export async function seedSettingsFixture(now: Date): Promise<void> {
  const recentSuccess = new Date(now.getTime() - 60_000);
  const recentFailure = new Date(now.getTime() - 30_000);

  await db.insert(pushSubscriptions).values([
    {
      id: SETTINGS_SUB_HEALTHY_ID,
      userId: LOCAL_USER_ID,
      endpoint: SETTINGS_FIXTURE.healthyEndpoint,
      p256dh: "e2e-fixture-p256dh-healthy",
      auth: "e2e-fixture-auth-healthy",
      userAgent: SETTINGS_FIXTURE.healthyUserAgent,
      lastSuccessAt: recentSuccess,
      lastFailureAt: null,
      failureCount: 0,
    },
    {
      id: SETTINGS_SUB_FAILING_ID,
      userId: LOCAL_USER_ID,
      endpoint: SETTINGS_FIXTURE.failingEndpoint,
      p256dh: "e2e-fixture-p256dh-failing",
      auth: "e2e-fixture-auth-failing",
      userAgent: SETTINGS_FIXTURE.failingUserAgent,
      lastSuccessAt: null,
      lastFailureAt: recentFailure,
      failureCount: SETTINGS_FIXTURE.failingCount,
    },
  ]);
}

/** How many change_log rows exist for the refresh fixture's book right now. */
export async function changeLogCountFor(bookId: string, field?: string): Promise<number> {
  const rows = await db
    .select({ id: changeLog.id, field: changeLog.field })
    .from(changeLog)
    .where(eq(changeLog.entityId, bookId));
  return field ? rows.filter((r) => r.field === field).length : rows.length;
}

/** The release date currently stored for a book, read straight from Postgres. */
export async function storedReleaseDateFor(bookId: string): Promise<string | null> {
  const rows = await db
    .select({ date: releases.date })
    .from(releases)
    .where(eq(releases.bookId, bookId))
    .limit(1);
  return rows[0]?.date ?? null;
}

/**
 * The literal history row the read path must find, written with the STRING
 * "release_date" rather than with RELEASE_DATE_FIELD.
 *
 * src/lib/changes.ts imports RELEASE_DATE_FIELD from src/lib/refresh/diff.ts,
 * so reader and writer already share one constant and a rename is a compile
 * error, not a silent drift. What that shared constant cannot prove is that
 * the literal actually reaching the `field` column of Postgres, and coming
 * back out of it, is "release_date". Hardcoding the string here means this
 * fixture keeps testing the real literal even if the constant were ever
 * changed, and Book detail rendering the move proves the whole round trip:
 * literal in, column, query, dateChangesFrom's filter, page.
 */
export const HISTORY_FIXTURE = {
  bookId: REFRESH_BOOK_ID,
  from: "2026-03-01",
  to: "2026-09-15",
  provider: "wikidata" as const,
};

export async function seedReleaseDateHistory(): Promise<void> {
  await db.insert(changeLog).values({
    entityType: "book",
    entityId: HISTORY_FIXTURE.bookId,
    field: "release_date",
    oldValue: HISTORY_FIXTURE.from,
    newValue: HISTORY_FIXTURE.to,
    provider: HISTORY_FIXTURE.provider,
  });
}

/**
 * Every push_subscriptions row currently stored under one endpoint. Returns
 * a list rather than a single row on purpose: the upsert test's whole point
 * is to detect a SECOND row appearing, which a `.limit(1)` read would hide.
 */
export async function subscriptionsByEndpoint(endpoint: string): Promise<
  Array<{
    id: string;
    userAgent: string | null;
    p256dh: string;
    auth: string;
    failureCount: number;
    lastFailureAt: Date | null;
  }>
> {
  return db
    .select({
      id: pushSubscriptions.id,
      userAgent: pushSubscriptions.userAgent,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
      failureCount: pushSubscriptions.failureCount,
      lastFailureAt: pushSubscriptions.lastFailureAt,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint));
}
