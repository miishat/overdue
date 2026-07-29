import { describe, expect, it } from "vitest";
import { deriveStatus, type StatusInput } from "./status";

const NOW = new Date("2026-07-28T00:00:00Z");

function input(partial: Partial<StatusInput>): StatusInput {
  return {
    now: NOW,
    date: null,
    precision: null,
    hasBookRecord: true,
    sourceOfficial: true,
    seriesStatus: "ongoing",
    lastSeriesReleaseAt: null,
    hiatusThresholdYears: 4,
    ...partial,
  };
}

describe("deriveStatus", () => {
  const cases: [string, Partial<StatusInput>, string][] = [
    ["complete series", { seriesStatus: "complete", hasBookRecord: false }, "COMPLETE"],
    ["past date", { date: new Date("2022-08-23"), precision: "day" }, "RELEASED"],
    ["future exact date", { date: new Date("2026-08-12"), precision: "day" }, "DATED"],
    ["future season", { date: new Date("2026-09-01"), precision: "season" }, "ESTIMATED"],
    ["future year", { date: new Date("2027-01-01"), precision: "year" }, "ESTIMATED"],
    ["future month", { date: new Date("2026-11-01"), precision: "month" }, "ESTIMATED"],
    ["future quarter", { date: new Date("2026-10-01"), precision: "quarter" }, "ESTIMATED"],
    ["record, no date, official", { date: null, sourceOfficial: true }, "ANNOUNCED"],
    ["record, no date, unofficial", { date: null, sourceOfficial: false }, "RUMORED"],
    [
      "no record, recent series activity",
      { hasBookRecord: false, lastSeriesReleaseAt: new Date("2024-01-01") },
      "EXPECTED",
    ],
    [
      "no record, long silence",
      { hasBookRecord: false, lastSeriesReleaseAt: new Date("2011-07-12") },
      "HIATUS",
    ],
  ];

  for (const [label, partial, expected] of cases) {
    it(`returns ${expected} for ${label}`, () => {
      expect(deriveStatus(input(partial))).toBe(expected);
    });
  }

  it("treats today as released, not dated", () => {
    expect(deriveStatus(input({ date: NOW, precision: "day" }))).toBe("RELEASED");
  });

  it("respects a custom hiatus threshold", () => {
    const base = {
      hasBookRecord: false,
      lastSeriesReleaseAt: new Date("2023-01-01"),
    };
    expect(deriveStatus(input({ ...base, hiatusThresholdYears: 10 }))).toBe("EXPECTED");
    expect(deriveStatus(input({ ...base, hiatusThresholdYears: 2 }))).toBe("HIATUS");
  });

  it("returns EXPECTED when the series has no release history at all", () => {
    expect(
      deriveStatus(input({ hasBookRecord: false, lastSeriesReleaseAt: null })),
    ).toBe("EXPECTED");
  });

  it("prefers COMPLETE over a past date", () => {
    expect(
      deriveStatus(
        input({ seriesStatus: "complete", hasBookRecord: false, date: new Date("2020-01-01") }),
      ),
    ).toBe("COMPLETE");
  });

  // Boundary tests

  it("boundary: date exactly on hiatus threshold boundary returns HIATUS", () => {
    const releaseDate = new Date("2022-07-28T00:00:00Z"); // exactly 4 years before NOW
    expect(
      deriveStatus(
        input({
          hasBookRecord: false,
          lastSeriesReleaseAt: releaseDate,
          hiatusThresholdYears: 4,
        }),
      ),
    ).toBe("HIATUS");
  });

  it("boundary: future date with no precision falls to ESTIMATED", () => {
    expect(
      deriveStatus(
        input({
          date: new Date("2026-08-12"),
          precision: null,
        }),
      ),
    ).toBe("ESTIMATED");
  });

  it("boundary: complete series with book record does not return COMPLETE", () => {
    expect(
      deriveStatus(
        input({
          seriesStatus: "complete",
          hasBookRecord: true,
          date: null,
          sourceOfficial: true,
        }),
      ),
    ).toBe("ANNOUNCED");
  });
});
