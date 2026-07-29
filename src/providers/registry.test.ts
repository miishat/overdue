import { describe, expect, it, vi } from "vitest";
import type { MetadataProvider, ProviderBook } from "./types";
import {
  searchAcross,
  getSeriesEntriesFromProviders,
  OFFICIAL_PROVIDERS,
  providers,
} from "./registry";

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

// A provider whose call never resolves on its own, simulating a hung
// endpoint (e.g. Wikidata's SPARQL endpoint taking 65s to 504 in production).
// It only settles if the signal passed to it is aborted, so it will hang
// forever unless the registry applies a timeout.
function neverResolvingProvider(name: MetadataProvider["name"]): MetadataProvider {
  return {
    name,
    official: false,
    searchBooks: vi.fn((_query: string, signal?: AbortSignal) => {
      return new Promise<ProviderBook[]>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }),
    getBook: vi.fn(async () => null),
    getSeries: vi.fn(async () => null),
    getSeriesEntries: vi.fn((_externalId: string, signal?: AbortSignal) => {
      return new Promise<ProviderBook[]>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }),
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

  it("does not let a slow provider delay the batch", async () => {
    const slow = neverResolvingProvider("wikidata");
    const results = await searchAcross(
      [slow, fakeProvider("google", [bookA])],
      "query",
      undefined,
      20, // short injected timeout so the test is fast and deterministic
    );
    expect(results).toEqual([bookA]);
  });

  it("still honours the caller's own abort signal", async () => {
    const controller = new AbortController();
    const slow = neverResolvingProvider("wikidata");
    const fast = fakeProvider("google", [bookA]);

    const resultsPromise = searchAcross([slow, fast], "query", controller.signal, 20);
    controller.abort();

    const results = await resultsPromise;
    // Both providers were called with an aborted signal; the fast one's
    // fake implementation resolves anyway, but the timeout wiring must not
    // throw or hang when the caller's signal fires.
    expect(Array.isArray(results)).toBe(true);
    expect(slow.searchBooks).toHaveBeenCalled();
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
      expect.any(AbortSignal),
    );
  });
});

describe("OFFICIAL_PROVIDERS", () => {
  it("matches each adapter's own official flag, plus manual", () => {
    expect(OFFICIAL_PROVIDERS.hardcover).toBe(true);
    expect(OFFICIAL_PROVIDERS.wikidata).toBe(true);
    expect(OFFICIAL_PROVIDERS.google).toBe(false);
    expect(OFFICIAL_PROVIDERS.openlibrary).toBe(false);
    expect(OFFICIAL_PROVIDERS.manual).toBe(true);
  });

  it("cannot drift from the registry: derives from every provider's own flag", () => {
    // Guards against a hand-maintained duplicate list: if a provider's
    // `official` flag changes, or a new provider is added, this table
    // must move with it rather than being independently edited.
    for (const provider of providers) {
      expect(OFFICIAL_PROVIDERS[provider.name]).toBe(provider.official);
    }
  });
});
