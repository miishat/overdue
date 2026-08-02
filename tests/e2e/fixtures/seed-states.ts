import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { books, series } from "@/db/schema/catalog";
import { changeLog } from "@/db/schema/changelog";
import { externalIds } from "@/db/schema/identity";
import { notificationQueue, pushSubscriptions } from "@/db/schema/push";
import { releases, releaseSources } from "@/db/schema/releases";
import { tracks } from "@/db/schema/tracking";
import { LOCAL_USER_ID } from "@/lib/current-user";

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
 * differs from what is stored, so a real refresh run produces a real diff
 * rather than one asserted against fake data in a unit test.
 *
 * The book is seeded with a WRONG release_date and linked, via a real
 * external_ids row, to Wikidata's entity for "Pride and Prejudice" (Q170583),
 * which carries a stable, long-settled P577 publication date
 * (1813-01-28, precision "day" per src/providers/wikidata.ts's
 * precisionFromWikidata: any precision code other than "9" or "10" maps to
 * "day", and Wikidata's statement uses precision 11). A refresh run calls the
 * real wikidataProvider.getBook against this fixed id, so the "external
 * provider changing the date underneath us" the task brief describes is not
 * simulated with a mock: refreshing this book really does correct a stored
 * value using a real, independent source, and a historical book's publication
 * date is as close to immovable as any live external fact can be.
 *
 * This is deliberately NOT run through the shelf's title/series display path;
 * the seeded title is overwritten by the real "Pride and Prejudice" title on
 * the first refresh, which is expected and does not affect any assertion
 * here, since refresh.spec.ts scopes every change_log assertion to this
 * book's id, never its title.
 */
// Deliberately the lowest-sorting id block in this fixture file (leading
// "00000000" rather than the "eeeeeeee" the other fixtures use). runRefresh
// (src/lib/refresh/slice.ts selectSlice) orders never-refreshed candidates
// by bookId ascending as its tie-break, and this endpoint's slice is bounded
// to DEFAULT_SLICE_SIZE (25). The developer's own, real tracked books share
// this database and may also have lastRefreshedAt: null (nothing has ever
// scheduled this endpoint before Task 17), so without a deliberately
// low-sorting id this book could be crowded out of the slice by real data and
// the refresh spec's assertions would silently never run against it. A
// random v4 UUID starting this low is astronomically unlikely, so this id
// sorts first with overwhelming certainty.
const REFRESH_BOOK_ID = "00000000-1111-4000-8000-000000000001";
const REFRESH_RELEASE_ID = "eeeeeeee-1111-4000-8000-000000000002";
const REFRESH_EXTERNAL_ID_ROW_ID = "eeeeeeee-1111-4000-8000-000000000003";
const REFRESH_RELEASE_SOURCE_ID = "eeeeeeee-1111-4000-8000-000000000004";
const REFRESH_TRACK_ID = "eeeeeeee-1111-4000-8000-000000000005";

// The real Wikidata entity refresh.spec.ts relies on; see the comment above.
const REFRESH_WIKIDATA_QID = "Q170583";

export const REFRESH_FIXTURE = {
  bookId: REFRESH_BOOK_ID,
  seededTitle: "E2E Refresh Target Book",
  // What providers correct the seeded release date to, once wikidata answers.
  correctedTitle: "Pride and Prejudice",
};

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
  await db
    .delete(releases)
    .where(inArray(releases.id, [...ALL_RELEASE_IDS, REFRESH_RELEASE_ID]));
  await db
    .delete(externalIds)
    .where(inArray(externalIds.id, [REFRESH_EXTERNAL_ID_ROW_ID]));
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
 * date is deliberately wrong (an arbitrary year, "1900-01-01") and whose
 * only known external source is the real Wikidata entity for "Pride and
 * Prejudice". A refresh run re-fetches that entity for real and corrects the
 * date, producing a genuine change_log row rather than one written by the
 * test itself. See REFRESH_FIXTURE's comment above for why this book, and
 * refresh.spec.ts for the assertions built on it.
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
    date: "1900-01-01",
    datePrecision: "year",
    status: "RELEASED",
  });

  await db.insert(releaseSources).values({
    id: REFRESH_RELEASE_SOURCE_ID,
    releaseId: REFRESH_RELEASE_ID,
    provider: "wikidata",
    valueSeen: "1900-01-01",
    trustRank: 70,
  });

  // The (provider, externalId) pair drizzleRefreshPort's loadKnownSources
  // reads to decide which providers to re-fetch. This is what actually
  // drives the real network call to Wikidata during refresh.
  await db.insert(externalIds).values({
    id: REFRESH_EXTERNAL_ID_ROW_ID,
    entityType: "book",
    entityId: REFRESH_BOOK_ID,
    provider: "wikidata",
    externalId: REFRESH_WIKIDATA_QID,
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
