import { describe, expect, it } from "vitest";
import { groupByHorizon, horizonFor } from "./horizons";
import type { ShelfEntry } from "./synthesise";

const NOW = new Date("2026-07-29T00:00:00Z");

function entry(overrides: Partial<ShelfEntry> = {}): ShelfEntry {
  return {
    key: "k",
    bookId: "b1",
    seriesId: null,
    title: "A Book",
    authorName: "An Author",
    seriesTitle: null,
    seriesPosition: null,
    coverUrl: null,
    status: "DATED",
    date: new Date("2026-08-15T00:00:00Z"),
    precision: "day",
    synthetic: false,
    lastSeriesReleaseAt: null,
    ...overrides,
  };
}

describe("horizonFor", () => {
  it("puts a date inside the current calendar month in This month", () => {
    const e = entry({ date: new Date("2026-07-31T00:00:00Z") });
    expect(horizonFor(e, NOW)).toBe("This month");
  });

  it("puts a date within the following three months in Next 3 months", () => {
    expect(horizonFor(entry({ date: new Date("2026-09-01Z") }), NOW)).toBe(
      "Next 3 months",
    );
  });

  it("puts a later date in the same year in Later this year", () => {
    expect(horizonFor(entry({ date: new Date("2026-12-01Z") }), NOW)).toBe(
      "Later this year",
    );
  });

  it("puts a date in a future year in Dated further out", () => {
    expect(horizonFor(entry({ date: new Date("2028-03-01Z") }), NOW)).toBe(
      "Dated further out",
    );
  });

  it("sorts an ESTIMATED window into a dated horizon, not No date yet", () => {
    const e = entry({
      status: "ESTIMATED",
      date: new Date("2026-09-01T00:00:00Z"),
      precision: "season",
    });
    expect(horizonFor(e, NOW)).toBe("Next 3 months");
  });

  it("puts ANNOUNCED and RUMORED in No date yet", () => {
    expect(
      horizonFor(entry({ status: "ANNOUNCED", date: null, precision: null }), NOW),
    ).toBe("No date yet");
    expect(
      horizonFor(entry({ status: "RUMORED", date: null, precision: null }), NOW),
    ).toBe("No date yet");
  });

  it("puts EXPECTED and HIATUS in Not announced", () => {
    expect(
      horizonFor(entry({ status: "EXPECTED", date: null, precision: null }), NOW),
    ).toBe("Not announced");
    expect(
      horizonFor(entry({ status: "HIATUS", date: null, precision: null }), NOW),
    ).toBe("Not announced");
  });

  it("puts a RELEASED item in This month when it came out this month", () => {
    const e = entry({
      status: "RELEASED",
      date: new Date("2026-07-02T00:00:00Z"),
    });
    expect(horizonFor(e, NOW)).toBe("This month");
  });
});

describe("groupByHorizon", () => {
  it("returns groups in the spec's order", () => {
    const groups = groupByHorizon(
      [
        entry({ key: "far", date: new Date("2029-01-01Z") }),
        entry({ key: "soon", date: new Date("2026-07-30Z") }),
        entry({
          key: "none",
          status: "EXPECTED",
          date: null,
          precision: null,
        }),
      ],
      NOW,
    );
    expect(groups.map((g) => g.horizon)).toEqual([
      "This month",
      "Dated further out",
      "Not announced",
    ]);
  });

  it("omits empty horizons entirely", () => {
    const groups = groupByHorizon([entry()], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].horizon).toBe("Next 3 months");
  });

  it("sorts entries inside a group by date, soonest first", () => {
    const groups = groupByHorizon(
      [
        entry({ key: "later", date: new Date("2026-09-20Z") }),
        entry({ key: "sooner", date: new Date("2026-09-02Z") }),
      ],
      NOW,
    );
    expect(groups[0].entries.map((e) => e.key)).toEqual(["sooner", "later"]);
  });

  it("breaks a date tie by putting the more precise entry first", () => {
    const groups = groupByHorizon(
      [
        entry({
          key: "vague",
          date: new Date("2026-09-01Z"),
          precision: "season",
          status: "ESTIMATED",
        }),
        entry({
          key: "exact",
          date: new Date("2026-09-01Z"),
          precision: "day",
        }),
      ],
      NOW,
    );
    expect(groups[0].entries.map((e) => e.key)).toEqual(["exact", "vague"]);
  });

  it("sorts undated entries by title, since there is no date to sort on", () => {
    const groups = groupByHorizon(
      [
        entry({ key: "z", title: "Zebra", status: "EXPECTED", date: null, precision: null }),
        entry({ key: "a", title: "Aardvark", status: "EXPECTED", date: null, precision: null }),
      ],
      NOW,
    );
    expect(groups[0].entries.map((e) => e.key)).toEqual(["a", "z"]);
  });

  it("returns an empty array for no entries", () => {
    expect(groupByHorizon([], NOW)).toEqual([]);
  });

  it("never places a COMPLETE entry on the shelf", () => {
    const groups = groupByHorizon(
      [entry({ status: "COMPLETE", date: null, precision: null })],
      NOW,
    );
    expect(groups).toEqual([]);
  });
});
