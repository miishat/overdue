import { describe, expect, it, vi } from "vitest";
import type { MetadataProvider, ProviderBook } from "./types";
import { searchAcross, getSeriesEntriesFromProviders } from "./registry";

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

const entryA: ProviderBook = {
  provider: "google",
  externalId: "entry-a",
  title: "Book A",
  authors: ["Author A"],
};
const entryB: ProviderBook = {
  provider: "hardcover",
  externalId: "entry-b",
  title: "Book B",
  authors: ["Author B"],
};

describe("getSeriesEntriesFromProviders", () => {
  it("resolves refs to matching providers and merges their entries", async () => {
    const googleProvider = fakeProvider("google", [entryA]);
    const hardcoverProvider = fakeProvider("hardcover", [entryB]);

    googleProvider.getSeriesEntries = vi.fn(async () => [entryA]);
    hardcoverProvider.getSeriesEntries = vi.fn(async () => [entryB]);

    const results = await getSeriesEntriesFromProviders(
      [googleProvider, hardcoverProvider],
      [
        { provider: "google", externalId: "series-1" },
        { provider: "hardcover", externalId: "series-2" },
      ],
    );

    expect(results).toHaveLength(2);
    expect(results).toEqual([entryA, entryB]);
  });

  it("yields no entries when provider name is not found in registry", async () => {
    const googleProvider = fakeProvider("google", [entryA]);
    googleProvider.getSeriesEntries = vi.fn(async () => [entryA]);

    const results = await getSeriesEntriesFromProviders(
      [googleProvider],
      [
        { provider: "google", externalId: "series-1" },
        { provider: "unknown", externalId: "series-2" },
      ],
    );

    expect(results).toEqual([entryA]);
    expect(results).toHaveLength(1);
  });

  it("ignores a provider that throws and returns entries from working providers", async () => {
    const googleProvider = fakeProvider("google", [entryA]);
    const hardcoverProvider = fakeProvider("hardcover", [], true);

    googleProvider.getSeriesEntries = vi.fn(async () => [entryA]);
    hardcoverProvider.getSeriesEntries = vi
      .fn()
      .mockRejectedValueOnce(new Error("provider error"));

    const results = await getSeriesEntriesFromProviders(
      [googleProvider, hardcoverProvider],
      [
        { provider: "google", externalId: "series-1" },
        { provider: "hardcover", externalId: "series-2" },
      ],
    );

    expect(results).toEqual([entryA]);
  });

  it("passes the correct externalId through to the resolved provider", async () => {
    const googleProvider = fakeProvider("google", [entryA]);
    googleProvider.getSeriesEntries = vi.fn(async () => [entryA]);

    const testExternalId = "test-series-123";
    await getSeriesEntriesFromProviders(
      [googleProvider],
      [{ provider: "google", externalId: testExternalId }],
    );

    expect(googleProvider.getSeriesEntries).toHaveBeenCalledWith(
      testExternalId,
      undefined,
    );
  });
});
