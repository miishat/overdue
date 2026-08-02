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
  it("records one row per provider that made a claim, using that provider's own reported date", async () => {
    const { releaseSourceRows } = await import("./persist");
    const rows = releaseSourceRows("release-1", [
      {
        provider: "hardcover",
        externalId: "h",
        sourceUrl: "https://hc/1",
        releaseDate: "2026-08-12",
      },
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

  it("stores null for a source that reported no date, not the resolved date", async () => {
    const { releaseSourceRows } = await import("./persist");
    const rows = releaseSourceRows("r", [
      { provider: "hardcover", externalId: "h", releaseDate: "2026-08-12" },
      { provider: "google", externalId: "g" },
    ]);

    const google = rows.find((r) => r.provider === "google");
    expect(google?.valueSeen).toBeNull();
  });

  it("carries each provider's own claimed date, not the resolved one, when providers disagree", async () => {
    const { releaseSourceRows } = await import("./persist");
    const rows = releaseSourceRows("r", [
      { provider: "hardcover", externalId: "h", releaseDate: "2026-08-12" },
      { provider: "wikidata", externalId: "w", releaseDate: "2026-09-01" },
    ]);

    const hardcover = rows.find((r) => r.provider === "hardcover");
    const wikidata = rows.find((r) => r.provider === "wikidata");
    expect(hardcover?.valueSeen).toBe("2026-08-12");
    expect(wikidata?.valueSeen).toBe("2026-09-01");
    expect(hardcover?.valueSeen).not.toBe(wikidata?.valueSeen);
  });

  it("ranks manual highest and google lowest", async () => {
    const { releaseSourceRows } = await import("./persist");
    const rows = releaseSourceRows("r", [
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

describe("persistResolvedBook dedup", () => {
  it("reuses the existing book id on a second persist of the same ResolvedBook instead of inserting a duplicate", async () => {
    vi.resetModules();

    const { books, series } = await import("@/db/schema/catalog");
    const { releases } = await import("@/db/schema/releases");
    const { externalIds } = await import("@/db/schema/identity");

    const deriveStatus = vi.fn(() => "ANNOUNCED");
    vi.doMock("@/resolution/status", () => ({ deriveStatus }));

    const state = { bookInsertCount: 0, externalIdRows: [] as { entityId: string }[] };
    vi.doMock("@/db/client", () => ({
      db: makeStatefulDbMock({ books, releases, series, externalIds }, state),
    }));

    const { persistResolvedBook } = await import("./persist");

    const book = {
      key: "isbn:dup",
      title: "Some Book",
      authors: [],
      provenance: {},
      sources: [{ provider: "hardcover" as const, externalId: "hc-99" }],
      confidence: 90,
    };

    const first = await persistResolvedBook(book);
    const second = await persistResolvedBook(book);

    expect(state.bookInsertCount).toBe(1);
    expect(second.bookId).toBe(first.bookId);

    vi.doUnmock("@/resolution/status");
    vi.doUnmock("@/db/client");
    vi.resetModules();
  });

  it("reuses the existing release row on a second persist instead of inserting a duplicate", async () => {
    vi.resetModules();

    const { books, series } = await import("@/db/schema/catalog");
    const { releases, releaseSources } = await import("@/db/schema/releases");
    const { externalIds } = await import("@/db/schema/identity");

    const deriveStatus = vi.fn(() => "ANNOUNCED");
    vi.doMock("@/resolution/status", () => ({ deriveStatus }));

    const state = {
      bookInsertCount: 0,
      externalIdRows: [] as { entityId: string }[],
      releaseInsertCount: 0,
      releaseRows: new Map<string, { id: string }>(),
      releaseSourceCalls: [] as { releaseId: string }[],
    };
    vi.doMock("@/db/client", () => ({
      db: makeStatefulDbMock(
        { books, releases, series, externalIds, releaseSources },
        state,
      ),
    }));

    const { persistResolvedBook } = await import("./persist");

    const book = {
      key: "isbn:dup-release",
      title: "Some Other Book",
      authors: [],
      provenance: {},
      sources: [{ provider: "hardcover" as const, externalId: "hc-100" }],
      confidence: 90,
    };

    await persistResolvedBook(book);
    await persistResolvedBook(book);

    expect(state.releaseInsertCount).toBe(1);
    expect(state.releaseSourceCalls).toHaveLength(2);
    expect(state.releaseSourceCalls[1].releaseId).toBe(
      state.releaseSourceCalls[0].releaseId,
    );

    vi.doUnmock("@/resolution/status");
    vi.doUnmock("@/db/client");
    vi.resetModules();
  });
});

describe("persistResolvedBook series linkage", () => {
  it("persists a discovered book with a series name with a non-null seriesId", async () => {
    vi.resetModules();

    const { books, series } = await import("@/db/schema/catalog");
    const { releases, releaseSources } = await import("@/db/schema/releases");
    const { externalIds } = await import("@/db/schema/identity");

    const deriveStatus = vi.fn(() => "ANNOUNCED");
    vi.doMock("@/resolution/status", () => ({ deriveStatus }));

    const state = makeSingleEntityState();
    vi.doMock("@/db/client", () => ({
      db: makeSingleEntityDbMock({ books, series, releases, releaseSources, externalIds }, state),
    }));

    const { persistResolvedBook } = await import("./persist");

    state.externalIdsQueue.push([]);
    const result = await persistResolvedBook({
      key: "isbn:series-link",
      title: "Book With Series",
      authors: [],
      provenance: {},
      sources: [{ provider: "hardcover" as const, externalId: "hc-link-1" }],
      confidence: 90,
      seriesName: "Some New Series",
    });

    expect(result.seriesId).not.toBeNull();

    vi.doUnmock("@/resolution/status");
    vi.doUnmock("@/db/client");
    vi.resetModules();
  });

  it("enriches an existing book with a cover and series on a second sighting without creating a duplicate", async () => {
    vi.resetModules();

    const { books, series } = await import("@/db/schema/catalog");
    const { releases, releaseSources } = await import("@/db/schema/releases");
    const { externalIds } = await import("@/db/schema/identity");

    const deriveStatus = vi.fn(() => "ANNOUNCED");
    vi.doMock("@/resolution/status", () => ({ deriveStatus }));

    const state = makeSingleEntityState();
    vi.doMock("@/db/client", () => ({
      db: makeSingleEntityDbMock({ books, series, releases, releaseSources, externalIds }, state),
    }));

    const { persistResolvedBook } = await import("./persist");

    const baseBook = {
      key: "isbn:enrich",
      title: "Enrich Me",
      authors: [],
      provenance: {},
      sources: [{ provider: "hardcover" as const, externalId: "hc-enrich" }],
      confidence: 90,
    };

    state.externalIdsQueue.push([]);
    const first = await persistResolvedBook(baseBook);

    state.externalIdsQueue.push([{ entityId: first.bookId }]);
    const second = await persistResolvedBook({
      ...baseBook,
      coverUrl: "https://covers.example/enrich.jpg",
      seriesName: "Enrich Series",
    });

    expect(state.bookInsertCount).toBe(1);
    expect(second.bookId).toBe(first.bookId);
    expect(second.seriesId).not.toBeNull();
    expect(state.singleBook?.coverUrl).toBe("https://covers.example/enrich.jpg");
    expect(state.singleBook?.seriesId).toBe(second.seriesId);

    vi.doUnmock("@/resolution/status");
    vi.doUnmock("@/db/client");
    vi.resetModules();
  });

  it("does not blank a field that a later sighting omits", async () => {
    vi.resetModules();

    const { books, series } = await import("@/db/schema/catalog");
    const { releases, releaseSources } = await import("@/db/schema/releases");
    const { externalIds } = await import("@/db/schema/identity");

    const deriveStatus = vi.fn(() => "ANNOUNCED");
    vi.doMock("@/resolution/status", () => ({ deriveStatus }));

    const state = makeSingleEntityState();
    vi.doMock("@/db/client", () => ({
      db: makeSingleEntityDbMock({ books, series, releases, releaseSources, externalIds }, state),
    }));

    const { persistResolvedBook } = await import("./persist");

    const baseBook = {
      key: "isbn:keep-description",
      title: "Keep My Description",
      authors: [],
      provenance: {},
      sources: [{ provider: "hardcover" as const, externalId: "hc-keep" }],
      confidence: 90,
      description: "A great book about things.",
    };

    state.externalIdsQueue.push([]);
    const first = await persistResolvedBook(baseBook);

    state.externalIdsQueue.push([{ entityId: first.bookId }]);
    await persistResolvedBook({
      ...baseBook,
      description: undefined,
    });

    expect(state.singleBook?.description).toBe("A great book about things.");

    vi.doUnmock("@/resolution/status");
    vi.doUnmock("@/db/client");
    vi.resetModules();
  });

  it("matches a series by external id across sightings under different titles", async () => {
    vi.resetModules();

    const { books, series } = await import("@/db/schema/catalog");
    const { releases, releaseSources } = await import("@/db/schema/releases");
    const { externalIds } = await import("@/db/schema/identity");

    const deriveStatus = vi.fn(() => "ANNOUNCED");
    vi.doMock("@/resolution/status", () => ({ deriveStatus }));

    const state = makeSingleEntityState();
    vi.doMock("@/db/client", () => ({
      db: makeSingleEntityDbMock({ books, series, releases, releaseSources, externalIds }, state),
    }));

    const { persistResolvedBook } = await import("./persist");

    const bookA = {
      key: "isbn:series-ext-a",
      title: "Book A",
      authors: [],
      provenance: { seriesExternalId: "hardcover" as const },
      sources: [{ provider: "hardcover" as const, externalId: "hc-ext-a" }],
      confidence: 90,
      seriesName: "Series Title A",
      seriesExternalId: "77",
    };
    const bookB = {
      key: "isbn:series-ext-b",
      title: "Book B",
      authors: [],
      provenance: { seriesExternalId: "hardcover" as const },
      sources: [{ provider: "hardcover" as const, externalId: "hc-ext-b" }],
      confidence: 90,
      seriesName: "Series Title B",
      seriesExternalId: "77",
    };

    state.externalIdsQueue.push([], []);
    const first = await persistResolvedBook(bookA);

    state.externalIdsQueue.push([{ entityId: state.singleSeries?.id }], []);
    const second = await persistResolvedBook(bookB);

    expect(first.seriesId).not.toBeNull();
    expect(second.seriesId).toBe(first.seriesId);

    vi.doUnmock("@/resolution/status");
    vi.doUnmock("@/db/client");
    vi.resetModules();
  });
});

// State and mock for the series-linkage / enrichment tests above. Unlike
// makeStatefulDbMock, this tracks a single book row and a single series row
// directly (each test only ever has one of each in flight at a time), and
// drives the two possible external_ids lookups per persist call (series by
// external id, then book by external id) off an explicit FIFO queue that
// each test primes before every persistResolvedBook call, since the mock
// cannot introspect the real drizzle where-clause to tell them apart.
function makeSingleEntityState() {
  return {
    externalIdsQueue: [] as { entityId: string }[][],
    bookInsertCount: 0,
    seriesInsertCount: 0,
    singleBook: null as
      | {
          id: string;
          title?: string;
          isbn13?: string;
          coverUrl?: string;
          description?: string;
          seriesId: string | null;
        }
      | null,
    singleSeries: null as { id: string; title: string } | null,
    seriesByTitle: new Map<string, string>(),
    lastSeriesInsertTitle: null as string | null,
    updateCalls: [] as Record<string, unknown>[],
  };
}

function makeSingleEntityDbMock(
  tables: {
    books: unknown;
    series: unknown;
    releases: unknown;
    releaseSources: unknown;
    externalIds: unknown;
  },
  state: ReturnType<typeof makeSingleEntityState>,
) {
  const select = () => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: async () => {
          if (table === tables.externalIds) return state.externalIdsQueue.shift() ?? [];
          if (table === tables.series) {
            const title = state.lastSeriesInsertTitle;
            const id = title ? state.seriesByTitle.get(title) : undefined;
            return id ? [{ id }] : [];
          }
          if (table === tables.books) {
            return state.singleBook ? [{ seriesId: state.singleBook.seriesId }] : [];
          }
          return [];
        },
      }),
    }),
  });

  const insert = (table: unknown) => ({
    values: (rows: unknown) => ({
      then: (resolve: (value: undefined) => void) => resolve(undefined),
      returning: async () => {
        if (table === tables.books) {
          state.bookInsertCount += 1;
          const id = `book-${state.bookInsertCount}`;
          const row = rows as {
            title?: string;
            isbn13?: string;
            coverUrl?: string;
            description?: string;
            seriesId?: string | null;
          };
          state.singleBook = {
            id,
            title: row.title,
            isbn13: row.isbn13,
            coverUrl: row.coverUrl,
            description: row.description,
            seriesId: row.seriesId ?? null,
          };
          return [{ id }];
        }
        if (table === tables.releases) return [{ id: "release-1" }];
        return [{ id: "row-1" }];
      },
      onConflictDoNothing: async () => {
        if (table === tables.series) {
          const row = rows as { title: string };
          state.lastSeriesInsertTitle = row.title;
          if (!state.seriesByTitle.has(row.title)) {
            state.seriesInsertCount += 1;
            const id = `series-${state.seriesInsertCount}`;
            state.seriesByTitle.set(row.title, id);
            state.singleSeries = { id, title: row.title };
          }
        }
        return undefined;
      },
      onConflictDoUpdate: () => ({
        returning: async () => {
          if (table === tables.releases) return [{ id: "release-1" }];
          return [{ id: "row-1" }];
        },
      }),
    }),
  });

  const update = (table: unknown) => ({
    set: (setObj: Record<string, unknown>) => ({
      where: async () => {
        if (table === tables.books && state.singleBook) {
          state.updateCalls.push(setObj);
          Object.assign(state.singleBook, setObj);
        }
        return undefined;
      },
    }),
  });

  const del = () => ({ where: async () => undefined });

  return { select, insert, update, delete: del };
}

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

  it("derives ANNOUNCED, not RUMORED, for a manual entry with no release date", async () => {
    vi.resetModules();

    const { books, releases } = await import("@/db/schema/catalog").then(
      async (catalog) => ({
        books: catalog.books,
        releases: (await import("@/db/schema/releases")).releases,
      }),
    );

    // deriveStatus itself is not mocked here: the point of this test is
    // that persistResolvedBook feeds it a sourceOfficial that is true for
    // a manual record, so the real status logic lands on ANNOUNCED rather
    // than RUMORED for a book with no date.
    const insertedReleases: { status: string }[] = [];
    const dbMock = makeDbMock({ books, releases });
    const originalInsert = dbMock.insert;
    dbMock.insert = ((table: unknown) => {
      const chain = originalInsert(table);
      if (table === releases) {
        const originalValues = chain.values;
        chain.values = (rows: unknown) => {
          const [row] = (Array.isArray(rows) ? rows : [rows]) as { status: string }[];
          insertedReleases.push({ status: row.status });
          return originalValues(rows);
        };
      }
      return chain;
    }) as typeof dbMock.insert;
    vi.doMock("@/db/client", () => ({ db: dbMock }));

    const { persistResolvedBook } = await import("./persist");

    // Shaped exactly like /api/manual's ResolvedBook: a manual source, no
    // provenance.releaseDate (nothing claimed a date), no releaseDate.
    const book = {
      key: "manual:some-unlisted-book",
      title: "Some Unlisted Book",
      authors: ["An Author"],
      provenance: { title: "manual" as const, authors: "manual" as const },
      sources: [{ provider: "manual" as const, externalId: "manual:some-unlisted-book" }],
      confidence: 100,
    };

    await persistResolvedBook(book);

    expect(insertedReleases[0]?.status).toBe("ANNOUNCED");
    expect(insertedReleases[0]?.status).not.toBe("RUMORED");

    vi.doUnmock("@/db/client");
    vi.resetModules();
  });

  it("derives RUMORED for a book known only to Google Books and Open Library with no date", async () => {
    vi.resetModules();

    const { books, releases } = await import("@/db/schema/catalog").then(
      async (catalog) => ({
        books: catalog.books,
        releases: (await import("@/db/schema/releases")).releases,
      }),
    );

    // deriveStatus itself is not mocked here: this is the counterpart to
    // the manual-entry test above. Google and Open Library are both
    // non-official providers, so a book known only to them with no date
    // must still land on RUMORED. This guards against a fix that makes
    // sourceOfficial true unconditionally (which would make the manual
    // test above pass for the wrong reason).
    const insertedReleases: { status: string }[] = [];
    const dbMock = makeDbMock({ books, releases });
    const originalInsert = dbMock.insert;
    dbMock.insert = ((table: unknown) => {
      const chain = originalInsert(table);
      if (table === releases) {
        const originalValues = chain.values;
        chain.values = (rows: unknown) => {
          const [row] = (Array.isArray(rows) ? rows : [rows]) as { status: string }[];
          insertedReleases.push({ status: row.status });
          return originalValues(rows);
        };
      }
      return chain;
    }) as typeof dbMock.insert;
    vi.doMock("@/db/client", () => ({ db: dbMock }));

    const { persistResolvedBook } = await import("./persist");

    const book = {
      key: "google:unofficial-only-book",
      title: "Unofficial Only Book",
      authors: ["An Author"],
      provenance: { title: "google" as const, authors: "google" as const },
      sources: [
        { provider: "google" as const, externalId: "g1" },
        { provider: "openlibrary" as const, externalId: "ol1" },
      ],
      confidence: 50,
    };

    await persistResolvedBook(book);

    expect(insertedReleases[0]?.status).toBe("RUMORED");
    expect(insertedReleases[0]?.status).not.toBe("ANNOUNCED");

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
        onConflictDoUpdate: () => ({
          returning: async () => {
            if (table === tables.releases) return [{ id: "release-1" }];
            return [{ id: "row-1" }];
          },
        }),
      }),
    };
  };

  const del = () => ({ where: async () => undefined });

  const update = () => ({ set: () => ({ where: async () => undefined }) });

  return { select, insert, delete: del, update };
}

// A stateful mock that tracks how many times `books` was inserted and
// remembers external_ids rows across calls, so it can simulate the
// external_ids lookup that dedup depends on.
function makeStatefulDbMock(
  tables: {
    books: unknown;
    releases: unknown;
    series: unknown;
    externalIds: unknown;
    releaseSources?: unknown;
  },
  state: {
    bookInsertCount: number;
    externalIdRows: { entityId: string }[];
    releaseInsertCount?: number;
    releaseRows?: Map<string, { id: string }>;
    releaseSourceCalls?: { releaseId: string }[];
  },
) {
  const select = () => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: async () => {
          if (table === tables.externalIds) {
            return state.externalIdRows.length > 0
              ? [{ entityId: state.externalIdRows[0].entityId }]
              : [];
          }
          return [];
        },
      }),
    }),
  });

  const insert = (table: unknown) => {
    return {
      values: (rows: unknown) => {
        if (table === tables.releaseSources && state.releaseSourceCalls) {
          const inserted = Array.isArray(rows) ? rows : [rows];
          const [{ releaseId }] = inserted as { releaseId: string }[];
          state.releaseSourceCalls.push({ releaseId });
        }
        return {
        then: (resolve: (value: undefined) => void) => resolve(undefined),
        returning: async () => {
          if (table === tables.books) {
            state.bookInsertCount += 1;
            return [{ id: "book-1" }];
          }
          if (table === tables.releases) return [{ id: "release-1" }];
          if (table === tables.series) return [{ id: "series-1" }];
          return [{ id: "row-1" }];
        },
        onConflictDoNothing: async () => {
          if (table === tables.externalIds) {
            const inserted = Array.isArray(rows) ? rows : [rows];
            for (const row of inserted as { entityId: string }[]) {
              state.externalIdRows.push({ entityId: row.entityId });
            }
          }
          return undefined;
        },
        onConflictDoUpdate: () => ({
          returning: async () => {
            if (table === tables.releases && state.releaseRows) {
              const row = (Array.isArray(rows) ? rows[0] : rows) as {
                bookId: string;
                region: string;
                format: string;
              };
              const key = `${row.bookId}|${row.region}|${row.format}`;
              const existing = state.releaseRows.get(key);
              if (existing) return [{ id: existing.id }];
              state.releaseInsertCount = (state.releaseInsertCount ?? 0) + 1;
              const id = `release-${state.releaseInsertCount}`;
              state.releaseRows.set(key, { id });
              return [{ id }];
            }
            return [{ id: "release-1" }];
          },
        }),
        };
      },
    };
  };

  const del = (table: unknown) => ({
    where: async () => {
      if (table === tables.releaseSources && state.releaseSourceCalls) {
        // Refresh semantics: clearing prior source rows for this release
        // before re-inserting is exercised implicitly by the insert mock
        // above tracking calls, so no state change is needed here.
        return undefined;
      }
      return undefined;
    },
  });

  const update = () => ({ set: () => ({ where: async () => undefined }) });

  return { select, insert, delete: del, update };
}

describe("resolveDateBelief", () => {
  it("keeps the stored date when the resolution reports none", async () => {
    // The incident: providers answered without a date and the stored date
    // was overwritten with null.
    const { resolveDateBelief } = await import("./persist");
    expect(
      resolveDateBelief({ date: "1966-01-01", datePrecision: "day" }, {}),
    ).toEqual({ date: "1966-01-01", precision: "day", asserted: false });
  });

  it("takes an asserted date over the stored one", async () => {
    const { resolveDateBelief } = await import("./persist");
    expect(
      resolveDateBelief(
        { date: "1966-01-01", datePrecision: "day" },
        { releaseDate: "1966-05-01", datePrecision: "month" },
      ),
    ).toEqual({ date: "1966-05-01", precision: "month", asserted: true });
  });

  it("sets a first-ever date when nothing is stored", async () => {
    const { resolveDateBelief } = await import("./persist");
    expect(
      resolveDateBelief(null, { releaseDate: "2027-03-02", datePrecision: "day" }),
    ).toEqual({ date: "2027-03-02", precision: "day", asserted: true });
  });

  it("still clears the date on an explicit withdrawal", async () => {
    const { resolveDateBelief } = await import("./persist");
    expect(
      resolveDateBelief({ date: "1966-01-01", datePrecision: "day" }, {
        releaseDate: null,
      }),
    ).toEqual({ date: null, precision: null, asserted: true });
  });

  it("moves date and precision as one unit, never mixing the two beliefs", async () => {
    const { resolveDateBelief } = await import("./persist");
    // A resolution with a precision but no date must not stamp that
    // precision onto the date it is preserving.
    expect(
      resolveDateBelief(
        { date: "1966-01-01", datePrecision: "day" },
        { datePrecision: "year" },
      ),
    ).toEqual({ date: "1966-01-01", precision: "day", asserted: false });
  });
});
