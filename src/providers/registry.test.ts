import { describe, expect, it, vi } from "vitest";
import type { MetadataProvider, ProviderBook } from "./types";
import { searchAcross } from "./registry";

function fakeProvider(
  name: MetadataProvider["name"],
  books: ProviderBook[],
  fail = false,
): MetadataProvider {
  return {
    name,
    official: false,
    searchBooks: vi.fn(async () => {
      if (fail) throw new Error("provider down");
      return books;
    }),
    getBook: vi.fn(async () => null),
    getSeries: vi.fn(async () => null),
    getSeriesEntries: vi.fn(async () => []),
  };
}

const bookA: ProviderBook = {
  provider: "google",
  externalId: "a",
  title: "A",
  authors: [],
};
const bookB: ProviderBook = {
  provider: "hardcover",
  externalId: "b",
  title: "B",
  authors: [],
};

describe("searchAcross", () => {
  it("merges results from every provider", async () => {
    const results = await searchAcross(
      [fakeProvider("google", [bookA]), fakeProvider("hardcover", [bookB])],
      "query",
    );
    expect(results).toHaveLength(2);
  });

  it("ignores a provider that throws", async () => {
    const results = await searchAcross(
      [
        fakeProvider("google", [bookA]),
        fakeProvider("hardcover", [bookB], true),
      ],
      "query",
    );
    expect(results).toEqual([bookA]);
  });

  it("returns an empty array when every provider fails", async () => {
    const results = await searchAcross(
      [fakeProvider("google", [], true), fakeProvider("hardcover", [], true)],
      "query",
    );
    expect(results).toEqual([]);
  });
});
