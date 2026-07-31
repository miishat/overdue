import { describe, expect, it } from "vitest";
import type { MetadataProvider, ProviderBook } from "@/providers/types";
import type { ProviderName } from "@/db/schema/enums";
import { fetchKnownSources, manualRecord, type StoredRelease } from "./sources";

function book(provider: ProviderName, overrides: Partial<ProviderBook> = {}): ProviderBook {
  return {
    provider,
    externalId: `${provider}-1`,
    title: "A Book",
    authors: ["An Author"],
    ...overrides,
  };
}

/**
 * Fakes are built inline rather than with vi.mock/vi.spyOn: this directory's
 * rule, and the reason the RefreshPort boundary exists at all.
 */
function fakeProvider(
  name: ProviderName,
  getBook: (externalId: string, signal?: AbortSignal) => Promise<ProviderBook | null>,
): MetadataProvider {
  return {
    name,
    official: true,
    async searchBooks() {
      return [];
    },
    getBook,
    async getSeries() {
      return null;
    },
    async getSeriesEntries() {
      return [];
    },
  };
}

function release(overrides: Partial<StoredRelease> = {}): StoredRelease {
  return {
    id: "r1",
    date: "2027-09-01",
    datePrecision: "day",
    sources: [],
    ...overrides,
  };
}

describe("fetchKnownSources", () => {
  it("returns every source when all providers answer", async () => {
    const list = [
      fakeProvider("hardcover", async () => book("hardcover")),
      fakeProvider("google", async () => book("google")),
    ];

    const result = await fetchKnownSources(
      list,
      [
        { provider: "hardcover", externalId: "h1" },
        { provider: "google", externalId: "g1" },
      ],
      release(),
    );

    expect(result.map((r) => r.provider)).toEqual(["hardcover", "google"]);
  });

  it("throws rather than resolving from the survivors when a known source rejects", async () => {
    const list = [
      fakeProvider("hardcover", async () => {
        throw new Error("hardcover timed out");
      }),
      fakeProvider("google", async () => book("google")),
    ];

    // The Critical: allSettled-and-discard would return google alone, and the
    // caller would rewrite the stored date from trust 30 while trust 80 was
    // merely unreachable, appending a change_log row and firing a push that
    // both flip back on the next run.
    await expect(
      fetchKnownSources(
        list,
        [
          { provider: "hardcover", externalId: "h1" },
          { provider: "google", externalId: "g1" },
        ],
        release(),
      ),
    ).rejects.toThrow(/hardcover timed out/);
  });

  it("names every unavailable source in the failure reason", async () => {
    const list = [
      fakeProvider("hardcover", async () => {
        throw new Error("boom");
      }),
    ];

    await expect(
      fetchKnownSources(list, [{ provider: "hardcover", externalId: "h1" }], release()),
    ).rejects.toThrow(/known sources unavailable, refusing to refresh: hardcover: boom/);
  });

  it("throws for a known source with no adapter, rather than silently skipping it", async () => {
    await expect(
      fetchKnownSources([], [{ provider: "wikidata", externalId: "Q1" }], release()),
    ).rejects.toThrow(/no adapter for known source provider wikidata/);
  });

  it("passes an abort signal that fires at the timeout", async () => {
    let seen: AbortSignal | undefined;
    const list = [
      fakeProvider("hardcover", async (_externalId, signal) => {
        seen = signal;
        // A hung provider: resolve only when the deadline aborts it.
        await new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => resolve());
        });
        throw new Error("aborted");
      }),
    ];

    const promise = fetchKnownSources(
      list,
      [{ provider: "hardcover", externalId: "h1" }],
      release(),
      undefined,
      5,
    );

    // Without a signal this never settles and the run stalls until the
    // platform kills the function, which is the exact mid-run death the
    // deferred write-back exists to survive.
    await expect(promise).rejects.toThrow(/known sources unavailable/);
    expect(seen).toBeInstanceOf(AbortSignal);
    expect(seen?.aborted).toBe(true);
  });

  it("returns nothing when no provider still knows the book", async () => {
    const list = [fakeProvider("hardcover", async () => null)];

    const result = await fetchKnownSources(
      list,
      [{ provider: "hardcover", externalId: "h1" }],
      release(),
    );

    expect(result).toEqual([]);
  });

  it("returns nothing for a manual-only book, so nothing is ever written back", async () => {
    const result = await fetchKnownSources(
      [],
      [{ provider: "manual", externalId: "m1" }],
      release(),
    );

    expect(result).toEqual([]);
  });

  it("feeds the stored manual source back in alongside the providers", async () => {
    const list = [fakeProvider("hardcover", async () => book("hardcover"))];

    const result = await fetchKnownSources(
      list,
      [
        { provider: "hardcover", externalId: "h1" },
        { provider: "manual", externalId: "m1" },
      ],
      release({
        date: "2028-03-04",
        datePrecision: "day",
        sources: [
          { provider: "manual", sourceUrl: null, valueSeen: "2028-03-04", trustRank: 100 },
        ],
      }),
    );

    // Without this, persistResolvedBook's delete-and-reinsert of
    // release_sources erases the manual row and re-derives the date from
    // providers alone, in violation of manual outranking every provider.
    const manual = result.find((r) => r.provider === "manual");
    expect(manual).toBeDefined();
    expect(manual?.releaseDate).toBe("2028-03-04");
    expect(manual?.datePrecision).toBe("day");
    // Appended last so it can never be resolveGroup's records[0] title
    // fallback, and with an empty title so it does not pin the title forever.
    expect(result[result.length - 1].provider).toBe("manual");
    expect(manual?.title).toBe("");
  });
});

describe("manualRecord", () => {
  it("keeps a dateless manual source present so its row survives the re-persist", () => {
    const record = manualRecord(
      "m1",
      release({ sources: [{ provider: "manual", sourceUrl: null, valueSeen: null, trustRank: 100 }] }),
    );

    expect(record.provider).toBe("manual");
    expect(record.releaseDate).toBeUndefined();
  });

  it("refuses to reconstruct when the manual date disagrees with the stored release", () => {
    expect(() =>
      manualRecord(
        "m1",
        release({
          date: "2027-09-01",
          sources: [
            { provider: "manual", sourceUrl: null, valueSeen: "2030-01-01", trustRank: 100 },
          ],
        }),
      ),
    ).toThrow(/refusing to refresh rather than risk destroying manual data/);
  });
});
