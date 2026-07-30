import { describe, expect, it } from "vitest";
import type { TrackedSeries } from "./synthesise";

// db/client.ts throws if DATABASE_URL is unset. neon() only builds a lazy
// query function at construction time and does not connect, so setting a
// placeholder here lets the pure-helper tests import series-detail.ts
// without ever touching a real database. See shelf.test.ts for the same
// pattern.
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";

const { buildSeriesRun } = await import("./series-detail");
type TrackedBookRow = import("./shelf").TrackedBookRow;

const NOW = new Date("2026-07-29T00:00:00Z");

function book(overrides: Partial<TrackedBookRow> = {}): TrackedBookRow {
  return {
    bookId: "b1",
    title: "A Book",
    authorName: "An Author",
    seriesId: "s1",
    seriesTitle: "A Series",
    seriesPosition: 1,
    coverUrl: null,
    releaseDate: new Date("2020-01-01T00:00:00Z"),
    precision: "day",
    sourceOfficial: true,
    seriesStatus: "ongoing",
    lastSeriesReleaseAt: null,
    ...overrides,
  };
}

function series(overrides: Partial<TrackedSeries> = {}): TrackedSeries {
  return {
    seriesId: "s1",
    seriesTitle: "A Series",
    seriesStatus: "ongoing",
    plannedLength: null,
    highestKnownPosition: 2,
    lastSeriesReleaseAt: new Date("2011-03-01T00:00:00Z"),
    ...overrides,
  };
}

describe("buildSeriesRun", () => {
  it("sorts entries by position ascending", () => {
    const run = buildSeriesRun({
      books: [
        book({ bookId: "b3", seriesPosition: 3 }),
        book({ bookId: "b1", seriesPosition: 1 }),
        book({ bookId: "b2", seriesPosition: 2 }),
      ],
      series: series({ seriesStatus: "complete" }),
      now: NOW,
    });

    expect(run.map((e) => e.bookId)).toEqual(["b1", "b2", "b3"]);
  });

  it("sorts a decimal position between its neighbours", () => {
    const run = buildSeriesRun({
      books: [
        book({ bookId: "b3", seriesPosition: 3 }),
        book({ bookId: "b2.5", seriesPosition: 2.5 }),
        book({ bookId: "b2", seriesPosition: 2 }),
      ],
      series: series({ seriesStatus: "complete" }),
      now: NOW,
    });

    expect(run.map((e) => e.bookId)).toEqual(["b2", "b2.5", "b3"]);
  });

  it("puts position-less entries last", () => {
    const run = buildSeriesRun({
      books: [
        book({ bookId: "b-none", seriesPosition: null }),
        book({ bookId: "b1", seriesPosition: 1 }),
        book({ bookId: "b2", seriesPosition: 2 }),
      ],
      series: series({ seriesStatus: "complete" }),
      now: NOW,
    });

    expect(run.map((e) => e.bookId)).toEqual(["b1", "b2", "b-none"]);
  });

  it("appends the synthetic next entry for an ongoing series", () => {
    const run = buildSeriesRun({
      books: [book({ bookId: "b1", seriesPosition: 1 })],
      series: series(),
      now: NOW,
    });

    expect(run).toHaveLength(2);
    expect(run[1].synthetic).toBe(true);
    expect(run[run.length - 1]).toBe(run.at(-1));
  });

  it("adds no synthetic entry for a complete series", () => {
    const run = buildSeriesRun({
      books: [book({ bookId: "b1", seriesPosition: 1 })],
      series: series({ seriesStatus: "complete" }),
      now: NOW,
    });

    expect(run.some((e) => e.synthetic)).toBe(false);
  });

  it("still renders the real books of a complete series", () => {
    const run = buildSeriesRun({
      books: [
        book({ bookId: "b1", seriesPosition: 1 }),
        book({ bookId: "b2", seriesPosition: 2 }),
      ],
      series: series({ seriesStatus: "complete" }),
      now: NOW,
    });

    expect(run.map((e) => e.bookId)).toEqual(["b1", "b2"]);
  });

  it("suppresses the synthetic entry when a real book is still pending", () => {
    // Books 1 and 2 have shipped; book 3 is real but pending (a future
    // release date). highestKnownPosition already counts book 3, so a
    // synthetic "Book 4" here would assert book 4 is confirmed-coming when
    // even book 3 hasn't shipped yet and could still slip.
    const run = buildSeriesRun({
      books: [
        book({
          bookId: "b1",
          seriesPosition: 1,
          releaseDate: new Date("2020-01-01T00:00:00Z"),
        }),
        book({
          bookId: "b2",
          seriesPosition: 2,
          releaseDate: new Date("2021-01-01T00:00:00Z"),
        }),
        book({
          bookId: "b3",
          seriesPosition: 3,
          releaseDate: new Date("2027-01-01T00:00:00Z"),
        }),
      ],
      series: series({ seriesStatus: "ongoing", highestKnownPosition: 3 }),
      now: NOW,
    });

    expect(run.map((e) => e.bookId)).toEqual(["b1", "b2", "b3"]);
    expect(run.some((e) => e.synthetic)).toBe(false);
  });

  it("returns an empty array for an empty, complete series", () => {
    const run = buildSeriesRun({
      books: [],
      series: series({ seriesStatus: "complete" }),
      now: NOW,
    });

    expect(run).toEqual([]);
  });
});
