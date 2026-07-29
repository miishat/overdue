import { describe, expect, it, vi } from "vitest";

// db/client.ts throws if DATABASE_URL is unset. neon() only builds a lazy
// query function at construction time and does not connect, so setting a
// placeholder here lets the pure-helper tests import persist.ts without
// ever touching a real database.
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";

describe("externalIdRows", () => {
  it("creates one row per provider source", async () => {
    const { externalIdRows } = await import("./persist");
    const rows = externalIdRows("book", "book-uuid", [
      { provider: "hardcover", externalId: "12345" },
      { provider: "google", externalId: "gbs-1" },
    ]);

    expect(rows).toEqual([
      {
        entityType: "book",
        entityId: "book-uuid",
        provider: "hardcover",
        externalId: "12345",
      },
      {
        entityType: "book",
        entityId: "book-uuid",
        provider: "google",
        externalId: "gbs-1",
      },
    ]);
  });

  it("deduplicates repeated provider and id pairs", async () => {
    const { externalIdRows } = await import("./persist");
    const rows = externalIdRows("book", "b", [
      { provider: "google", externalId: "g" },
      { provider: "google", externalId: "g" },
    ]);
    expect(rows).toHaveLength(1);
  });
});

describe("releaseSourceRows", () => {
  it("records one row per provider that made a claim", async () => {
    const { releaseSourceRows } = await import("./persist");
    const rows = releaseSourceRows("release-1", "2026-08-12", [
      { provider: "hardcover", externalId: "h", sourceUrl: "https://hc/1" },
      { provider: "google", externalId: "g" },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      releaseId: "release-1",
      provider: "hardcover",
      sourceUrl: "https://hc/1",
      valueSeen: "2026-08-12",
    });
  });

  it("ranks manual highest and google lowest", async () => {
    const { releaseSourceRows } = await import("./persist");
    const rows = releaseSourceRows("r", null, [
      { provider: "google", externalId: "g" },
      { provider: "manual", externalId: "m" },
    ]);

    const google = rows.find((r) => r.provider === "google");
    const manual = rows.find((r) => r.provider === "manual");
    expect(manual?.trustRank).toBeGreaterThan(google?.trustRank ?? 0);
  });
});

describe("authorRows", () => {
  it("assigns positions in order and drops blanks", async () => {
    const { authorRows } = await import("./persist");
    expect(authorRows(["Neil Gaiman", "  ", "Terry Pratchett"])).toEqual([
      { name: "Neil Gaiman", sortName: "gaiman neil", position: 0 },
      { name: "Terry Pratchett", sortName: "pratchett terry", position: 1 },
    ]);
  });

  it("handles single-word names", async () => {
    const { authorRows } = await import("./persist");
    expect(authorRows(["Homer"])).toEqual([
      { name: "Homer", sortName: "homer", position: 0 },
    ]);
  });
});

describe("persistResolvedBook status derivation", () => {
  it("computes sourceOfficial from provenance.releaseDate being hardcover, wikidata, or manual", async () => {
    vi.resetModules();

    const { books, releases } = await import("@/db/schema/catalog").then(
      async (catalog) => ({
        books: catalog.books,
        releases: (await import("@/db/schema/releases")).releases,
      }),
    );

    const deriveStatus = vi.fn(() => "ANNOUNCED");
    vi.doMock("@/resolution/status", () => ({ deriveStatus }));
    vi.doMock("@/db/client", () => ({ db: makeDbMock({ books, releases }) }));

    const { persistResolvedBook } = await import("./persist");

    const book = {
      key: "isbn:1",
      title: "Some Book",
      authors: [],
      provenance: { releaseDate: "wikidata" },
      sources: [],
      confidence: 90,
      releaseDate: "2026-01-01",
      datePrecision: "day" as const,
    };

    await persistResolvedBook(book);

    expect(deriveStatus).toHaveBeenCalledWith(
      expect.objectContaining({ sourceOfficial: true }),
    );

    vi.doUnmock("@/resolution/status");
    vi.doUnmock("@/db/client");
    vi.resetModules();
  });

  it("sourceOfficial is false for google provenance", async () => {
    vi.resetModules();

    const { books, releases } = await import("@/db/schema/catalog").then(
      async (catalog) => ({
        books: catalog.books,
        releases: (await import("@/db/schema/releases")).releases,
      }),
    );

    const deriveStatus = vi.fn(() => "RUMORED");
    vi.doMock("@/resolution/status", () => ({ deriveStatus }));
    vi.doMock("@/db/client", () => ({ db: makeDbMock({ books, releases }) }));

    const { persistResolvedBook } = await import("./persist");

    const book = {
      key: "isbn:2",
      title: "Another Book",
      authors: [],
      provenance: { releaseDate: "google" },
      sources: [],
      confidence: 40,
    };

    await persistResolvedBook(book);

    expect(deriveStatus).toHaveBeenCalledWith(
      expect.objectContaining({ sourceOfficial: false }),
    );

    vi.doUnmock("@/resolution/status");
    vi.doUnmock("@/db/client");
    vi.resetModules();
  });
});

// Builds a minimal chainable mock of the drizzle `db` object sufficient for
// persistResolvedBook's select/insert/returning chains, without touching the
// live database. Identifies which table is being inserted into by reference
// so it can hand back a plausible id for `books` vs `releases`.
function makeDbMock(tables: { books: unknown; releases: unknown }) {
  const select = () => ({
    from: () => ({
      where: () => ({
        limit: async () => [],
      }),
    }),
  });

  const insert = (table: unknown) => {
    return {
      values: () => ({
        then: (resolve: (value: undefined) => void) => resolve(undefined),
        returning: async () => {
          if (table === tables.books) return [{ id: "book-1" }];
          if (table === tables.releases) return [{ id: "release-1" }];
          return [{ id: "row-1" }];
        },
        onConflictDoNothing: async () => undefined,
      }),
    };
  };

  return { select, insert };
}
