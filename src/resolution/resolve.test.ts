import { describe, expect, it } from "vitest";
import type { ProviderBook } from "@/providers/types";
import { groupByIdentity } from "./identity";
import { resolveGroup } from "./resolve";
import { TRUST } from "./trust";

function book(partial: Partial<ProviderBook>): ProviderBook {
  return {
    provider: "google",
    externalId: "x",
    title: "Untitled",
    authors: [],
    ...partial,
  };
}

describe("TRUST", () => {
  it("puts manual first on every field", () => {
    for (const order of Object.values(TRUST)) {
      expect(order[0]).toBe("manual");
    }
  });

  it("never trusts Google for series ordinal", () => {
    expect(TRUST.seriesPosition).not.toContain("google");
  });

  it("prefers Hardcover over Wikidata for series membership", () => {
    const order = TRUST.seriesName;
    expect(order.indexOf("hardcover")).toBeLessThan(order.indexOf("wikidata"));
  });
});

describe("resolveGroup", () => {
  it("takes series data from Hardcover over Google", () => {
    const group = groupByIdentity([
      book({ provider: "google", externalId: "g", title: "Babel", seriesName: "Wrong Series", seriesPosition: 9, isbn13: "9780008501815" }),
      book({ provider: "hardcover", externalId: "h", title: "Babel", seriesName: "Right Series", seriesPosition: 1, isbn13: "9780008501815" }),
    ])[0];

    const resolved = resolveGroup(group);
    expect(resolved.seriesName).toBe("Right Series");
    expect(resolved.seriesPosition).toBe(1);
    expect(resolved.provenance.seriesName).toBe("hardcover");
  });

  it("takes the cover from Open Library over Hardcover", () => {
    const group = groupByIdentity([
      book({ provider: "hardcover", externalId: "h", title: "Babel", coverUrl: "https://hc/cover.jpg", isbn13: "9780008501815" }),
      book({ provider: "openlibrary", externalId: "o", title: "Babel", coverUrl: "https://ol/cover.jpg", isbn13: "9780008501815" }),
    ])[0];

    const resolved = resolveGroup(group);
    expect(resolved.coverUrl).toBe("https://ol/cover.jpg");
    expect(resolved.provenance.coverUrl).toBe("openlibrary");
  });

  it("lets manual override a higher-ranked provider", () => {
    const group = groupByIdentity([
      book({ provider: "hardcover", externalId: "h", title: "Babel", seriesPosition: 1, isbn13: "9780008501815" }),
      book({ provider: "manual", externalId: "m", title: "Babel", seriesPosition: 2.5, isbn13: "9780008501815" }),
    ])[0];

    expect(resolveGroup(group).seriesPosition).toBe(2.5);
  });

  it("falls back down the trust order when the top provider lacks the field", () => {
    const group = groupByIdentity([
      book({ provider: "hardcover", externalId: "h", title: "Babel", isbn13: "9780008501815" }),
      book({ provider: "google", externalId: "g", title: "Babel", description: "Only Google has this.", isbn13: "9780008501815" }),
    ])[0];

    const resolved = resolveGroup(group);
    expect(resolved.description).toBe("Only Google has this.");
    expect(resolved.provenance.description).toBe("google");
  });

  it("raises confidence when providers agree and lowers it when they disagree", () => {
    const agree = groupByIdentity([
      book({ provider: "hardcover", externalId: "h", title: "Babel", releaseDate: "2022-08-23", isbn13: "9780008501815" }),
      book({ provider: "google", externalId: "g", title: "Babel", releaseDate: "2022-08-23", isbn13: "9780008501815" }),
    ])[0];

    const disagree = groupByIdentity([
      book({ provider: "hardcover", externalId: "h", title: "Babel", releaseDate: "2022-08-23", isbn13: "9780008501816" }),
      book({ provider: "google", externalId: "g", title: "Babel", releaseDate: "2023-01-01", isbn13: "9780008501816" }),
    ])[0];

    expect(resolveGroup(agree).confidence).toBeGreaterThan(
      resolveGroup(disagree).confidence,
    );
  });

  it("leaves no provenance entry and an undefined value for a field present on no provider", () => {
    const group = groupByIdentity([
      book({ provider: "hardcover", externalId: "h", title: "Babel", isbn13: "9780008501815" }),
      book({ provider: "google", externalId: "g", title: "Babel", isbn13: "9780008501815" }),
    ])[0];

    const resolved = resolveGroup(group);
    expect(resolved.provenance.description).toBeUndefined();
    expect(resolved.description).toBeUndefined();
  });

  it("does not let a whitespace-only string from the top provider beat a real value from a lower one", () => {
    const group = groupByIdentity([
      book({ provider: "hardcover", externalId: "h", title: "   ", isbn13: "9780008501815" }),
      book({ provider: "google", externalId: "g", title: "Babel", isbn13: "9780008501815" }),
    ])[0];

    const resolved = resolveGroup(group);
    expect(resolved.title).toBe("Babel");
    expect(resolved.provenance.title).toBe("google");
  });

  it("does not let an empty authors array from the top provider beat a populated one from a lower one", () => {
    const group = groupByIdentity([
      book({ provider: "hardcover", externalId: "h", title: "Babel", authors: [], isbn13: "9780008501815" }),
      book({ provider: "google", externalId: "g", title: "Babel", authors: ["R.F. Kuang"], isbn13: "9780008501815" }),
    ])[0];

    const resolved = resolveGroup(group);
    expect(resolved.authors).toEqual(["R.F. Kuang"]);
    expect(resolved.provenance.authors).toBe("google");
  });

  it("includes one sources entry per record, preserving provider, externalId and sourceUrl", () => {
    const group = groupByIdentity([
      book({ provider: "hardcover", externalId: "h1", title: "Babel", isbn13: "9780008501815", sourceUrl: "https://hardcover.app/books/h1" }),
      book({ provider: "google", externalId: "g1", title: "Babel", isbn13: "9780008501815", sourceUrl: "https://books.google.com/g1" }),
    ])[0];

    const resolved = resolveGroup(group);
    expect(resolved.sources).toHaveLength(2);
    expect(resolved.sources).toEqual(
      expect.arrayContaining([
        { provider: "hardcover", externalId: "h1", sourceUrl: "https://hardcover.app/books/h1" },
        { provider: "google", externalId: "g1", sourceUrl: "https://books.google.com/g1" },
      ]),
    );
  });
});
