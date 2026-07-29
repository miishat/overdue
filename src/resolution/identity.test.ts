import { describe, expect, it } from "vitest";
import type { ProviderBook } from "@/providers/types";
import { groupByIdentity, normaliseTitle } from "./identity";

function book(partial: Partial<ProviderBook>): ProviderBook {
  return {
    provider: "google",
    externalId: "x",
    title: "Untitled",
    authors: [],
    ...partial,
  };
}

describe("normaliseTitle", () => {
  it("lowercases, strips punctuation and leading articles", () => {
    expect(normaliseTitle("The Way of Kings!")).toBe("way of kings");
    expect(normaliseTitle("A Dance with Dragons")).toBe("dance with dragons");
  });

  it("collapses whitespace", () => {
    expect(normaliseTitle("  Babel   ")).toBe("babel");
  });
});

describe("groupByIdentity", () => {
  it("groups records sharing an ISBN13 regardless of title differences", () => {
    const groups = groupByIdentity([
      book({ provider: "google", externalId: "g1", title: "Babel", isbn13: "9780008501815" }),
      book({
        provider: "hardcover",
        externalId: "h1",
        title: "Babel: Or the Necessity of Violence",
        isbn13: "9780008501815",
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].records).toHaveLength(2);
  });

  it("groups on normalised title plus first author when ISBN is absent", () => {
    const groups = groupByIdentity([
      book({ provider: "wikidata", externalId: "Q1", title: "The Winds of Winter", authors: ["George R. R. Martin"] }),
      book({ provider: "hardcover", externalId: "h2", title: "Winds of Winter", authors: ["George R. R. Martin"] }),
    ]);

    expect(groups).toHaveLength(1);
  });

  it("keeps different books apart", () => {
    const groups = groupByIdentity([
      book({ externalId: "1", title: "Babel", authors: ["R. F. Kuang"] }),
      book({ externalId: "2", title: "Yellowface", authors: ["R. F. Kuang"] }),
    ]);

    expect(groups).toHaveLength(2);
  });

  it("does not merge same-titled books by different authors", () => {
    const groups = groupByIdentity([
      book({ externalId: "1", title: "Ascension", authors: ["Nicholas Binge"] }),
      book({ externalId: "2", title: "Ascension", authors: ["Oliver Harris"] }),
    ]);

    expect(groups).toHaveLength(2);
  });

  it("returns an empty array for empty input", () => {
    expect(groupByIdentity([])).toEqual([]);
  });

  it("groups a record with no authors by title alone without throwing", () => {
    expect(() =>
      groupByIdentity([
        book({ externalId: "1", title: "Mystery Book", authors: [] }),
        book({ externalId: "2", title: "Mystery Book", authors: [] }),
      ]),
    ).not.toThrow();

    const groups = groupByIdentity([
      book({ externalId: "1", title: "Mystery Book", authors: [] }),
      book({ externalId: "2", title: "Mystery Book", authors: [] }),
    ]);

    expect(groups).toHaveLength(1);
  });

  it("produces the same group count regardless of input order", () => {
    const a = book({
      provider: "google",
      externalId: "g1",
      title: "Babel",
      authors: ["R. F. Kuang"],
      isbn13: "9780008501815",
    });
    const b = book({
      provider: "hardcover",
      externalId: "h1",
      title: "Babel: Or the Necessity of Violence",
      authors: ["R. F. Kuang"],
      isbn13: "9780008501815",
    });
    const c = book({
      provider: "wikidata",
      externalId: "w1",
      title: "Babel",
      authors: ["R. F. Kuang"],
    });

    const forward = groupByIdentity([a, b, c]);
    const reversed = groupByIdentity([c, b, a]);

    expect(forward).toHaveLength(1);
    expect(reversed).toHaveLength(1);
    expect(forward.length).toBe(reversed.length);
  });
});
