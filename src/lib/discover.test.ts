import { describe, expect, it, vi } from "vitest";
import type { ProviderBook } from "@/providers/types";
import type { SeriesRef } from "@/providers/registry";

const getSeriesEntriesFromAll = vi.fn<
  (refs: SeriesRef[], signal?: AbortSignal) => Promise<ProviderBook[]>
>();
vi.mock("@/providers/registry", () => ({ getSeriesEntriesFromAll }));

describe("discoverSeriesEntries", () => {
  it("merges the same entry reported by two providers", async () => {
    getSeriesEntriesFromAll.mockResolvedValueOnce([
      {
        provider: "hardcover",
        externalId: "h6",
        title: "The Winds of Winter",
        authors: ["George R. R. Martin"],
        seriesPosition: 6,
      },
      {
        provider: "wikidata",
        externalId: "Q5678",
        title: "Winds of Winter",
        authors: ["George R. R. Martin"],
        seriesPosition: 6,
      },
    ]);

    const { discoverSeriesEntries } = await import("./discover");
    const entries = await discoverSeriesEntries([
      { provider: "hardcover", externalId: "77" },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0].seriesPosition).toBe(6);
  });

  it("orders entries by series position", async () => {
    getSeriesEntriesFromAll.mockResolvedValueOnce([
      { provider: "hardcover", externalId: "b", title: "Book Two", authors: ["A"], seriesPosition: 2 },
      { provider: "hardcover", externalId: "a", title: "Book One", authors: ["A"], seriesPosition: 1 },
      { provider: "hardcover", externalId: "c", title: "Novella", authors: ["A"], seriesPosition: 1.5 },
    ]);

    const { discoverSeriesEntries } = await import("./discover");
    const entries = await discoverSeriesEntries([
      { provider: "hardcover", externalId: "77" },
    ]);

    expect(entries.map((e) => e.seriesPosition)).toEqual([1, 1.5, 2]);
  });

  it("puts entries without a position last", async () => {
    getSeriesEntriesFromAll.mockResolvedValueOnce([
      { provider: "hardcover", externalId: "u", title: "Unplaced", authors: ["A"] },
      { provider: "hardcover", externalId: "a", title: "Book One", authors: ["A"], seriesPosition: 1 },
    ]);

    const { discoverSeriesEntries } = await import("./discover");
    const entries = await discoverSeriesEntries([
      { provider: "hardcover", externalId: "77" },
    ]);

    expect(entries[0].title).toBe("Book One");
    expect(entries[1].title).toBe("Unplaced");
  });

  it("returns an empty array without calling the registry when refs is empty", async () => {
    getSeriesEntriesFromAll.mockClear();

    const { discoverSeriesEntries } = await import("./discover");
    const entries = await discoverSeriesEntries([]);

    expect(entries).toEqual([]);
    expect(getSeriesEntriesFromAll).not.toHaveBeenCalled();
  });

  it("sorts decimal positions numerically, not as strings", async () => {
    getSeriesEntriesFromAll.mockResolvedValueOnce([
      { provider: "hardcover", externalId: "ten", title: "Book Ten", authors: ["A"], seriesPosition: 10 },
      { provider: "hardcover", externalId: "one", title: "Book One", authors: ["A"], seriesPosition: 1 },
      { provider: "hardcover", externalId: "onefive", title: "Book 1.5", authors: ["A"], seriesPosition: 1.5 },
      { provider: "hardcover", externalId: "two", title: "Book Two", authors: ["A"], seriesPosition: 2 },
    ]);

    const { discoverSeriesEntries } = await import("./discover");
    const entries = await discoverSeriesEntries([
      { provider: "hardcover", externalId: "77" },
    ]);

    expect(entries.map((e) => e.seriesPosition)).toEqual([1, 1.5, 2, 10]);
  });
});
