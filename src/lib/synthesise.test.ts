import { describe, expect, it } from "vitest";
import { synthesiseSeriesEntry, type TrackedSeries } from "./synthesise";

const NOW = new Date("2026-07-29T00:00:00Z");

function series(overrides: Partial<TrackedSeries> = {}): TrackedSeries {
  return {
    seriesId: "s1",
    seriesTitle: "The Kingkiller Chronicle",
    seriesStatus: "ongoing",
    plannedLength: 3,
    highestKnownPosition: 2,
    lastSeriesReleaseAt: new Date("2011-03-01T00:00:00Z"),
    ...overrides,
  };
}

describe("synthesiseSeriesEntry", () => {
  it("synthesises HIATUS when the last release is older than the threshold", () => {
    const entry = synthesiseSeriesEntry(series(), NOW, 4);
    expect(entry).not.toBeNull();
    expect(entry?.status).toBe("HIATUS");
  });

  it("synthesises EXPECTED when the last release is inside the threshold", () => {
    const entry = synthesiseSeriesEntry(
      series({ lastSeriesReleaseAt: new Date("2024-01-01T00:00:00Z") }),
      NOW,
      4,
    );
    expect(entry?.status).toBe("EXPECTED");
  });

  it("returns null for a complete series, which never reaches the shelf", () => {
    expect(
      synthesiseSeriesEntry(series({ seriesStatus: "complete" }), NOW, 4),
    ).toBeNull();
  });

  it("marks the entry synthetic and carries no bookId", () => {
    const entry = synthesiseSeriesEntry(series(), NOW, 4);
    expect(entry?.synthetic).toBe(true);
    expect(entry?.bookId).toBeNull();
  });

  it("names the next position after the highest known one", () => {
    const entry = synthesiseSeriesEntry(
      series({ highestKnownPosition: 2 }),
      NOW,
      4,
    );
    expect(entry?.seriesPosition).toBe(3);
    expect(entry?.title).toBe("Book 3");
  });

  it("starts at position 1 when the series has no known entries", () => {
    const entry = synthesiseSeriesEntry(
      series({ highestKnownPosition: null, lastSeriesReleaseAt: null }),
      NOW,
      4,
    );
    expect(entry?.seriesPosition).toBe(1);
    expect(entry?.title).toBe("Book 1");
  });

  it("rounds a decimal position up, so after 2.5 comes 3", () => {
    const entry = synthesiseSeriesEntry(
      series({ highestKnownPosition: 2.5 }),
      NOW,
      4,
    );
    expect(entry?.seriesPosition).toBe(3);
  });

  it("returns null when the series is already at its planned length", () => {
    const entry = synthesiseSeriesEntry(
      series({ plannedLength: 3, highestKnownPosition: 3 }),
      NOW,
      4,
    );
    expect(entry).toBeNull();
  });

  it("carries a stable key derived from the series id", () => {
    const a = synthesiseSeriesEntry(series(), NOW, 4);
    const b = synthesiseSeriesEntry(series(), NOW, 4);
    expect(a?.key).toBe("synthetic:s1");
    expect(a?.key).toBe(b?.key);
  });

  it("has no date and no precision, because nothing is announced", () => {
    const entry = synthesiseSeriesEntry(series(), NOW, 4);
    expect(entry?.date).toBeNull();
    expect(entry?.precision).toBeNull();
  });

  it("carries lastSeriesReleaseAt so HIATUS can render elapsed time", () => {
    const entry = synthesiseSeriesEntry(series(), NOW, 4);
    expect(entry?.lastSeriesReleaseAt).toEqual(
      new Date("2011-03-01T00:00:00Z"),
    );
  });

  it("honours a custom hiatus threshold", () => {
    const twelveYearsAgo = series({
      lastSeriesReleaseAt: new Date("2014-07-29T00:00:00Z"),
    });
    expect(synthesiseSeriesEntry(twelveYearsAgo, NOW, 4)?.status).toBe(
      "HIATUS",
    );
    expect(synthesiseSeriesEntry(twelveYearsAgo, NOW, 20)?.status).toBe(
      "EXPECTED",
    );
  });
});
