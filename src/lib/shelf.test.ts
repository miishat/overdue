import { describe, expect, it } from "vitest";
import type { TrackedSeries } from "./synthesise";

// db/client.ts throws if DATABASE_URL is unset. neon() only builds a lazy
// query function at construction time and does not connect, so setting a
// placeholder here lets the pure-helper tests import shelf.ts without ever
// touching a real database. See persist.test.ts for the same pattern.
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";

const { buildShelf, loadShelf, mergeTrackedBookIds } = await import("./shelf");
type ShelfDataSource = import("./shelf").ShelfDataSource;
type TrackedBookRow = import("./shelf").TrackedBookRow;

const NOW = new Date("2026-07-29T00:00:00Z");

function book(overrides: Partial<TrackedBookRow> = {}): TrackedBookRow {
  return {
    bookId: "b1",
    title: "A Book",
    authorName: "An Author",
    seriesId: null,
    seriesTitle: null,
    seriesPosition: null,
    coverUrl: null,
    releaseDate: new Date("2026-09-14T00:00:00Z"),
    precision: "day",
    sourceOfficial: true,
    seriesStatus: null,
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

describe("buildShelf", () => {
  it("derives status rather than trusting a stored value", () => {
    const entries = buildShelf({ books: [book()], series: [], now: NOW });
    expect(entries[0].status).toBe("DATED");
  });

  it("derives RELEASED for a past date", () => {
    const entries = buildShelf({
      books: [book({ releaseDate: new Date("2020-01-01T00:00:00Z") })],
      series: [],
      now: NOW,
    });
    expect(entries[0].status).toBe("RELEASED");
  });

  it("derives ESTIMATED for a coarse future precision", () => {
    const entries = buildShelf({
      books: [
        book({
          releaseDate: new Date("2027-09-01T00:00:00Z"),
          precision: "season",
        }),
      ],
      series: [],
      now: NOW,
    });
    expect(entries[0].status).toBe("ESTIMATED");
  });

  it("derives ANNOUNCED for an undated book from an official source", () => {
    const entries = buildShelf({
      books: [book({ releaseDate: null, precision: null, sourceOfficial: true })],
      series: [],
      now: NOW,
    });
    expect(entries[0].status).toBe("ANNOUNCED");
  });

  it("derives RUMORED for an undated book from an unofficial source", () => {
    const entries = buildShelf({
      books: [
        book({ releaseDate: null, precision: null, sourceOfficial: false }),
      ],
      series: [],
      now: NOW,
    });
    expect(entries[0].status).toBe("RUMORED");
  });

  it("adds a synthetic entry for a tracked series with nothing pending", () => {
    const entries = buildShelf({ books: [], series: [series()], now: NOW });
    expect(entries).toHaveLength(1);
    expect(entries[0].synthetic).toBe(true);
    expect(entries[0].status).toBe("HIATUS");
  });

  it("suppresses the synthetic entry when the series already has an undated book", () => {
    const entries = buildShelf({
      books: [
        book({
          bookId: "b5",
          seriesId: "s1",
          releaseDate: null,
          precision: null,
        }),
      ],
      series: [series()],
      now: NOW,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].synthetic).toBe(false);
  });

  it("suppresses the synthetic entry when the series already has a future book", () => {
    const entries = buildShelf({
      books: [
        book({
          bookId: "b5",
          seriesId: "s1",
          releaseDate: new Date("2027-01-01T00:00:00Z"),
        }),
      ],
      series: [series()],
      now: NOW,
    });
    expect(entries.filter((e) => e.synthetic)).toHaveLength(0);
  });

  it("still synthesises when the series only has past releases", () => {
    const entries = buildShelf({
      books: [
        book({
          bookId: "b1",
          seriesId: "s1",
          releaseDate: new Date("2011-03-01T00:00:00Z"),
        }),
      ],
      series: [series()],
      now: NOW,
    });
    expect(entries.filter((e) => e.synthetic)).toHaveLength(1);
  });

  it("never emits a COMPLETE entry, since the shelf excludes them", () => {
    const entries = buildShelf({
      books: [],
      series: [series({ seriesStatus: "complete" })],
      now: NOW,
    });
    expect(entries).toEqual([]);
  });

  it("uses the default 4 year hiatus threshold", () => {
    const entries = buildShelf({
      books: [],
      series: [
        series({ lastSeriesReleaseAt: new Date("2023-01-01T00:00:00Z") }),
      ],
      now: NOW,
    });
    expect(entries[0].status).toBe("EXPECTED");
  });

  it("honours an overridden hiatus threshold", () => {
    const entries = buildShelf({
      books: [],
      series: [
        series({ lastSeriesReleaseAt: new Date("2023-01-01T00:00:00Z") }),
      ],
      now: NOW,
      hiatusThresholdYears: 2,
    });
    expect(entries[0].status).toBe("HIATUS");
  });

  it("gives every entry a unique key", () => {
    const entries = buildShelf({
      books: [book({ bookId: "b1" }), book({ bookId: "b2" })],
      series: [series()],
      now: NOW,
    });
    const keys = entries.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("returns an empty shelf when nothing is tracked", () => {
    expect(buildShelf({ books: [], series: [], now: NOW })).toEqual([]);
  });

  // Tracking a whole series is the primary way anything gets tracked, and
  // trackedBooks resolves those books through tracks.seriesId (see
  // mergeTrackedBookIds below). buildShelf itself does not care how a book
  // row reached it, but this pins the scenario the review flagged: a
  // series-tracked series whose real book is still pending must suppress
  // the synthetic entry, exactly like a directly-tracked book does.
  it("suppresses the synthetic entry for a series tracked as a whole when one of its real books is pending", () => {
    const entries = buildShelf({
      books: [
        book({
          bookId: "b9",
          seriesId: "s1",
          releaseDate: null,
          precision: null,
          sourceOfficial: true,
        }),
      ],
      series: [series()],
      now: NOW,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].bookId).toBe("b9");
    expect(entries[0].status).toBe("ANNOUNCED");
    expect(entries.some((e) => e.synthetic)).toBe(false);
  });
});

describe("mergeTrackedBookIds", () => {
  it("unions direct book ids and series-reachable book ids", () => {
    const result = mergeTrackedBookIds(["b1"], ["b2", "b3"]);
    expect(new Set(result)).toEqual(new Set(["b1", "b2", "b3"]));
  });

  it("dedupes a book id reachable both directly and through its series", () => {
    const result = mergeTrackedBookIds(["b1", "b2"], ["b2", "b3"]);
    expect(result).toHaveLength(3);
    expect(new Set(result)).toEqual(new Set(["b1", "b2", "b3"]));
  });

  it("returns an empty list when neither source has any ids", () => {
    expect(mergeTrackedBookIds([], [])).toEqual([]);
  });
});

describe("loadShelf", () => {
  it("passes the resolved user id to both queries and builds the result", async () => {
    const seen: string[] = [];
    const source: ShelfDataSource = {
      async trackedBooks(userId) {
        seen.push(userId);
        return [book()];
      },
      async trackedSeries(userId) {
        seen.push(userId);
        return [];
      },
    };

    const entries = await loadShelf(source, NOW);

    expect(entries).toHaveLength(1);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });
});
