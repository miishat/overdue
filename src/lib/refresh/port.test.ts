import { describe, expect, it } from "vitest";
import type { ProviderBook } from "@/providers/types";
import { resolveGroup } from "@/resolution/resolve";
import { diffSnapshots, RELEASE_DATE_FIELD } from "./diff";
import type { BookSnapshot } from "./snapshot";

// db/client.ts throws if DATABASE_URL is unset. neon() only builds a lazy
// query function at construction time and does not connect, so a placeholder
// lets port.ts be imported without ever touching a real database. Every case
// below keeps stored.seriesId non-null, which is the branch where
// predictSnapshot short-circuits its series lookup and issues no query.
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";

const NOW = new Date("2026-07-30T00:00:00Z");

function stored(overrides: Partial<BookSnapshot> = {}): BookSnapshot {
  return {
    bookId: "book-1",
    title: "Babel-17",
    seriesId: "series-1",
    seriesPosition: null,
    coverUrl: null,
    releaseDate: "1966-01-01",
    datePrecision: "day",
    status: "RELEASED",
    sourceProvider: "openlibrary",
    ...overrides,
  };
}

/** Exactly what the incident's Open Library adapter returned: no date. */
function openLibraryRecord(overrides: Partial<ProviderBook> = {}): ProviderBook {
  return {
    provider: "openlibrary",
    externalId: "OL1M",
    title: "Babel-17",
    authors: ["Samuel R. Delany"],
    ...overrides,
  };
}

async function predict(before: BookSnapshot, records: ProviderBook[]) {
  const { predictSnapshot } = await import("./port");
  const resolved = resolveGroup({ key: before.bookId, records });
  return predictSnapshot(before, resolved, NOW);
}

describe("predictSnapshot release date", () => {
  it("keeps the stored date when the only responding provider reports no date", async () => {
    // The real incident: a refresh reached only Open Library, which returned
    // the book WITHOUT a release date, and the stored 1966-01-01 was wiped.
    const before = stored();
    const after = await predict(before, [openLibraryRecord()]);

    expect(after.releaseDate).toBe("1966-01-01");
    expect(after.datePrecision).toBe("day");

    const rows = diffSnapshots(before, after);
    expect(rows.filter((row) => row.field === RELEASE_DATE_FIELD)).toEqual([]);
    expect(rows.filter((row) => row.field === "date_precision")).toEqual([]);
  });

  it("still moves the date when a provider asserts a different one", async () => {
    const before = stored();
    const after = await predict(before, [
      openLibraryRecord({ releaseDate: "1966-05-01", datePrecision: "month" }),
    ]);

    expect(after.releaseDate).toBe("1966-05-01");
    expect(after.datePrecision).toBe("month");

    const move = diffSnapshots(before, after).find(
      (row) => row.field === RELEASE_DATE_FIELD,
    );
    expect(move).toMatchObject({
      oldValue: "1966-01-01",
      newValue: "1966-05-01",
      provider: "openlibrary",
    });
  });

  it("sets a first-ever date on a book that has none stored", async () => {
    const before = stored({ releaseDate: null, datePrecision: null, status: "RUMORED" });
    const after = await predict(before, [
      openLibraryRecord({ releaseDate: "2027-03-02", datePrecision: "day" }),
    ]);

    expect(after.releaseDate).toBe("2027-03-02");
    const move = diffSnapshots(before, after).find(
      (row) => row.field === RELEASE_DATE_FIELD,
    );
    expect(move).toMatchObject({ oldValue: null, newValue: "2027-03-02" });
  });

  it("records a withdrawal when the date is explicitly asserted empty", async () => {
    // No adapter can produce this today (see resolveDateBelief in persist.ts):
    // it is the channel an authoritative retraction travels on, and the point
    // of the test is that the fill-only rule above has not closed it.
    const { predictSnapshot } = await import("./port");
    const before = stored();
    const resolved = resolveGroup({ key: before.bookId, records: [openLibraryRecord()] });
    const after = await predictSnapshot(
      before,
      { ...resolved, releaseDate: null },
      NOW,
    );

    expect(after.releaseDate).toBeNull();
    const move = diffSnapshots(before, after).find(
      (row) => row.field === RELEASE_DATE_FIELD,
    );
    expect(move).toMatchObject({ oldValue: "1966-01-01", newValue: null });
  });
});
