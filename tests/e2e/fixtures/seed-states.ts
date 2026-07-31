import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { books, series } from "@/db/schema/catalog";
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
  await db.delete(tracks).where(inArray(tracks.id, ALL_TRACK_IDS));
  await db
    .delete(releaseSources)
    .where(inArray(releaseSources.id, ALL_RELEASE_SOURCE_IDS));
  await db.delete(releases).where(inArray(releases.id, ALL_RELEASE_IDS));
  await db.delete(books).where(inArray(books.id, ALL_BOOK_IDS));
  await db.delete(series).where(inArray(series.id, ALL_SERIES_IDS));
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
