import { describe, expect, it } from "vitest";
import {
  formatElapsed,
  formatImprecise,
  formatMove,
  formatStamp,
} from "./provenance";

const NOW = new Date("2026-07-29T00:00:00Z");

describe("formatStamp", () => {
  it("renders provider and days since check in the spec's format", () => {
    expect(
      formatStamp({
        provider: "wikidata",
        lastVerifiedAt: new Date("2026-07-23T00:00:00Z"),
        now: NOW,
      }),
    ).toBe("WIKIDATA · CHK 6d");
  });

  it("renders a same-day check as 0d rather than blank", () => {
    expect(
      formatStamp({
        provider: "hardcover",
        lastVerifiedAt: NOW,
        now: NOW,
      }),
    ).toBe("HARDCOVER · CHK 0d");
  });

  it("labels the manual provider as MANUAL", () => {
    expect(
      formatStamp({
        provider: "manual",
        lastVerifiedAt: new Date("2026-07-28T00:00:00Z"),
        now: NOW,
      }),
    ).toBe("MANUAL · CHK 1d");
  });

  it("switches to weeks past 30 days to keep the stamp short", () => {
    expect(
      formatStamp({
        provider: "google",
        lastVerifiedAt: new Date("2026-06-01T00:00:00Z"),
        now: NOW,
      }),
    ).toBe("GOOGLE · CHK 8w");
  });

  it("switches to years past 52 weeks", () => {
    expect(
      formatStamp({
        provider: "openlibrary",
        lastVerifiedAt: new Date("2024-07-29T00:00:00Z"),
        now: NOW,
      }),
    ).toBe("OPENLIBRARY · CHK 2y");
  });
});

describe("formatMove", () => {
  it("reports a later move with a plus sign", () => {
    const move = formatMove({
      from: new Date("2026-08-01T00:00:00Z"),
      to: new Date("2026-09-12T00:00:00Z"),
    });
    expect(move.label).toBe("MOVED +6W");
    expect(move.direction).toBe("later");
  });

  it("reports an earlier move with a minus sign", () => {
    const move = formatMove({
      from: new Date("2026-09-12T00:00:00Z"),
      to: new Date("2026-08-01T00:00:00Z"),
    });
    expect(move.label).toBe("MOVED -6W");
    expect(move.direction).toBe("earlier");
  });

  it("uses days for a move under two weeks", () => {
    const move = formatMove({
      from: new Date("2026-08-01T00:00:00Z"),
      to: new Date("2026-08-06T00:00:00Z"),
    });
    expect(move.label).toBe("MOVED +5D");
  });

  it("uses years for a move over a year", () => {
    const move = formatMove({
      from: new Date("2026-08-01T00:00:00Z"),
      to: new Date("2028-08-01T00:00:00Z"),
    });
    expect(move.label).toBe("MOVED +2Y");
  });
});

describe("formatElapsed", () => {
  it("renders years for a long gap, which is the HIATUS case", () => {
    expect(formatElapsed(new Date("2011-03-01T00:00:00Z"), NOW)).toBe("15 yrs");
  });

  it("uses a singular year at exactly one", () => {
    expect(formatElapsed(new Date("2025-07-29T00:00:00Z"), NOW)).toBe("1 yr");
  });

  it("renders months under a year", () => {
    expect(formatElapsed(new Date("2026-02-01T00:00:00Z"), NOW)).toBe("5 mo");
  });
});

describe("formatImprecise", () => {
  it("renders a season as a season name and year", () => {
    expect(
      formatImprecise(new Date("2027-09-01T00:00:00Z"), "season"),
    ).toBe("Fall 2027");
  });

  it("renders a quarter as Q and year", () => {
    expect(formatImprecise(new Date("2027-07-01T00:00:00Z"), "quarter")).toBe(
      "Q3 2027",
    );
  });

  it("renders a month as month name and year", () => {
    expect(formatImprecise(new Date("2027-03-01T00:00:00Z"), "month")).toBe(
      "March 2027",
    );
  });

  it("renders a year as just the year", () => {
    expect(formatImprecise(new Date("2027-01-01T00:00:00Z"), "year")).toBe(
      "2027",
    );
  });

  it("renders a day precision as a full date", () => {
    expect(formatImprecise(new Date("2027-03-14T00:00:00Z"), "day")).toBe(
      "14 Mar 2027",
    );
  });
});
