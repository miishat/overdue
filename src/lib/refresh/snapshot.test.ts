import { describe, expect, it } from "vitest";
import {
  snapshotEquals,
  snapshotFields,
  type BookSnapshot,
} from "./snapshot";

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

describe("snapshotFields", () => {
  it("lists every watched field", () => {
    expect([...snapshotFields()]).toEqual([
      "title",
      "seriesId",
      "seriesPosition",
      "coverUrl",
      "releaseDate",
      "datePrecision",
      "status",
    ]);
  });

  it("does not watch bookId, which identifies rather than describes", () => {
    expect(snapshotFields()).not.toContain("bookId");
  });

  it("does not watch sourceProvider, which is provenance rather than a value", () => {
    expect(snapshotFields()).not.toContain("sourceProvider");
  });
});

describe("snapshotEquals", () => {
  it("is true for identical snapshots", () => {
    expect(snapshotEquals(snap(), snap())).toBe(true);
  });

  it("is false when a watched field differs", () => {
    expect(snapshotEquals(snap(), snap({ releaseDate: "2027-10-01" }))).toBe(
      false,
    );
  });

  it("ignores a change to the source provider alone", () => {
    expect(
      snapshotEquals(snap(), snap({ sourceProvider: "hardcover" })),
    ).toBe(true);
  });

  it("treats null and a value as different", () => {
    expect(snapshotEquals(snap(), snap({ releaseDate: null }))).toBe(false);
  });

  it("treats two nulls as equal", () => {
    expect(
      snapshotEquals(snap({ coverUrl: null }), snap({ coverUrl: null })),
    ).toBe(true);
  });
});
