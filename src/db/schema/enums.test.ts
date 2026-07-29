import { describe, expect, it } from "vitest";
import { DATE_PRECISIONS, PROVIDER_NAMES, RELEASE_STATUSES } from "./enums";

describe("enum value lists", () => {
  it("lists the five providers", () => {
    expect(PROVIDER_NAMES).toEqual([
      "manual",
      "hardcover",
      "wikidata",
      "openlibrary",
      "google",
    ]);
  });

  it("lists the five date precisions", () => {
    expect(DATE_PRECISIONS).toEqual([
      "day",
      "month",
      "quarter",
      "season",
      "year",
    ]);
  });

  it("lists all eight release statuses", () => {
    expect(RELEASE_STATUSES).toHaveLength(8);
    expect(RELEASE_STATUSES).toContain("HIATUS");
    expect(RELEASE_STATUSES).toContain("COMPLETE");
  });
});
