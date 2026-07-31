import { describe, expect, it } from "vitest";
import { CHANGE_FIELDS, RELEASE_DATE_FIELD, diffSnapshots } from "./diff";
import type { BookSnapshot } from "./snapshot";

function snap(overrides: Partial<BookSnapshot> = {}): BookSnapshot {
  return {
    bookId: "b1",
    title: "A Book",
    seriesId: null,
    seriesPosition: null,
    coverUrl: null,
    releaseDate: "2027-09-01",
    datePrecision: "season",
    status: "ESTIMATED",
    sourceProvider: "wikidata",
    ...overrides,
  };
}

describe("the ChangeLog field contract", () => {
  it("uses the exact string src/lib/changes.ts filters on", () => {
    expect(RELEASE_DATE_FIELD).toBe("release_date");
  });

  it("maps every watched camelCase field to a snake_case stored name", () => {
    expect(CHANGE_FIELDS.releaseDate).toBe("release_date");
    expect(CHANGE_FIELDS.datePrecision).toBe("date_precision");
    expect(CHANGE_FIELDS.seriesId).toBe("series_id");
    expect(CHANGE_FIELDS.seriesPosition).toBe("series_position");
    expect(CHANGE_FIELDS.coverUrl).toBe("cover_url");
    expect(CHANGE_FIELDS.title).toBe("title");
    expect(CHANGE_FIELDS.status).toBe("status");
  });
});

describe("diffSnapshots", () => {
  it("returns nothing when nothing changed", () => {
    expect(diffSnapshots(snap(), snap())).toEqual([]);
  });

  it("reports a release date move with the contracted field name", () => {
    const rows = diffSnapshots(
      snap({ releaseDate: "2027-09-01" }),
      snap({ releaseDate: "2028-01-15" }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].field).toBe("release_date");
    expect(rows[0].oldValue).toBe("2027-09-01");
    expect(rows[0].newValue).toBe("2028-01-15");
    expect(rows[0].entityType).toBe("book");
    expect(rows[0].entityId).toBe("b1");
  });

  it("records the provider that supplied the new value", () => {
    const rows = diffSnapshots(
      snap(),
      snap({ releaseDate: "2028-01-15", sourceProvider: "hardcover" }),
    );
    expect(rows[0].provider).toBe("hardcover");
  });

  it("reports several changed fields as several rows", () => {
    const rows = diffSnapshots(
      snap(),
      snap({ releaseDate: "2028-01-15", status: "DATED", title: "Renamed" }),
    );
    expect(rows.map((r) => r.field).sort()).toEqual([
      "release_date",
      "status",
      "title",
    ]);
  });

  it("reports a first-ever date as a change from null", () => {
    const rows = diffSnapshots(
      snap({ releaseDate: null, datePrecision: null, status: "ANNOUNCED" }),
      snap({ releaseDate: "2028-01-15", datePrecision: "day", status: "DATED" }),
    );
    const dateRow = rows.find((r) => r.field === "release_date");
    expect(dateRow?.oldValue).toBeNull();
    expect(dateRow?.newValue).toBe("2028-01-15");
  });

  it("reports a date being withdrawn as a change to null", () => {
    const rows = diffSnapshots(
      snap(),
      snap({ releaseDate: null, datePrecision: null, status: "ANNOUNCED" }),
    );
    const dateRow = rows.find((r) => r.field === "release_date");
    expect(dateRow?.oldValue).toBe("2027-09-01");
    expect(dateRow?.newValue).toBeNull();
  });

  it("ignores a provider change that did not change any value", () => {
    expect(
      diffSnapshots(snap(), snap({ sourceProvider: "hardcover" })),
    ).toEqual([]);
  });

  it("serialises a numeric field as a string, since change_log stores text", () => {
    const rows = diffSnapshots(
      snap({ seriesPosition: 2 }),
      snap({ seriesPosition: 3 }),
    );
    expect(rows[0].oldValue).toBe("2");
    expect(rows[0].newValue).toBe("3");
  });
});
