import { describe, expect, it } from "vitest";
import type { ChangeRow } from "./diff";
import { runRefresh, type RefreshPort } from "./run";
import type { BookSnapshot } from "./snapshot";

const NOW = new Date("2026-07-30T00:00:00Z");

function snap(bookId: string, overrides: Partial<BookSnapshot> = {}): BookSnapshot {
  return {
    bookId,
    title: "A Book",
    seriesId: null,
    seriesPosition: null,
    coverUrl: null,
    releaseDate: "2027-09-01",
    datePrecision: "season",
    status: "ESTIMATED",
    sourceProvider: "wikidata",
    ...overrides,
  };
}

interface Recorded {
  written: ChangeRow[];
  marked: string[];
  queued: Array<{ kind: string; payload: unknown }>;
}

function port(
  overrides: Partial<RefreshPort> = {},
): { port: RefreshPort; recorded: Recorded } {
  const recorded: Recorded = { written: [], marked: [], queued: [] };

  const base: RefreshPort = {
    async candidates() {
      return [{ bookId: "b1", lastRefreshedAt: null, seriesId: null }];
    },
    async currentSnapshot(bookId) {
      return snap(bookId);
    },
    async refetchSnapshot(bookId) {
      return snap(bookId);
    },
    async writeChanges(rows) {
      recorded.written.push(...rows);
    },
    async markRefreshed(bookIds) {
      recorded.marked.push(...bookIds);
    },
    async enqueue(_userId, kind, payload) {
      recorded.queued.push({ kind, payload });
    },
    ...overrides,
  };

  return { port: base, recorded };
}

describe("runRefresh", () => {
  it("writes nothing when nothing changed", async () => {
    const { port: p, recorded } = port();
    const result = await runRefresh(p, NOW);

    expect(result.examined).toBe(1);
    expect(result.changed).toBe(0);
    expect(recorded.written).toEqual([]);
    expect(recorded.queued).toEqual([]);
  });

  it("is idempotent: a second identical run still writes nothing", async () => {
    const { port: p, recorded } = port();
    await runRefresh(p, NOW);
    await runRefresh(p, NOW);
    expect(recorded.written).toEqual([]);
  });

  it("writes a change row when a date moved", async () => {
    const { port: p, recorded } = port({
      async refetchSnapshot(bookId) {
        return snap(bookId, { releaseDate: "2028-01-15" });
      },
    });

    const result = await runRefresh(p, NOW);

    expect(result.changed).toBe(1);
    expect(recorded.written).toHaveLength(1);
    expect(recorded.written[0].field).toBe("release_date");
  });

  it("marks a successfully refreshed book", async () => {
    const { port: p, recorded } = port();
    await runRefresh(p, NOW);
    expect(recorded.marked).toEqual(["b1"]);
  });

  it("does not abort the whole run when one book fails", async () => {
    const { port: p, recorded } = port({
      async candidates() {
        return [
          { bookId: "bad", lastRefreshedAt: null, seriesId: null },
          { bookId: "good", lastRefreshedAt: null, seriesId: null },
        ];
      },
      async refetchSnapshot(bookId) {
        if (bookId === "bad") throw new Error("provider exploded");
        return snap(bookId, { releaseDate: "2028-01-15" });
      },
    });

    const result = await runRefresh(p, NOW);

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].bookId).toBe("bad");
    expect(recorded.written).toHaveLength(1);
    expect(recorded.written[0].entityId).toBe("good");
  });

  it("does not mark a failed book as refreshed", async () => {
    const { port: p, recorded } = port({
      async refetchSnapshot() {
        throw new Error("provider exploded");
      },
    });

    await runRefresh(p, NOW);

    expect(recorded.marked).toEqual([]);
  });

  it("skips a book with no current snapshot rather than throwing", async () => {
    const { port: p, recorded } = port({
      async currentSnapshot() {
        return null;
      },
    });

    const result = await runRefresh(p, NOW);

    expect(result.examined).toBe(1);
    expect(recorded.written).toEqual([]);
  });

  it("skips a book the providers no longer return", async () => {
    const { port: p, recorded } = port({
      async refetchSnapshot() {
        return null;
      },
    });

    await runRefresh(p, NOW);

    expect(recorded.written).toEqual([]);
  });

  it("respects the slice size", async () => {
    const { port: p } = port({
      async candidates() {
        return Array.from({ length: 50 }, (_, i) => ({
          bookId: `b${i}`,
          lastRefreshedAt: null,
          seriesId: null,
        }));
      },
    });

    const result = await runRefresh(p, NOW, 3);

    expect(result.examined).toBe(3);
  });

  it("enqueues an instant alert for a date change", async () => {
    const { port: p, recorded } = port({
      async refetchSnapshot(bookId) {
        return snap(bookId, { releaseDate: "2028-01-15" });
      },
    });

    await runRefresh(p, NOW);

    expect(recorded.queued.map((q) => q.kind)).toContain("date_change");
  });

  it("does not enqueue an alert for a non-date change", async () => {
    const { port: p, recorded } = port({
      async refetchSnapshot(bookId) {
        return snap(bookId, { title: "Renamed" });
      },
    });

    await runRefresh(p, NOW);

    expect(recorded.queued.map((q) => q.kind)).not.toContain("date_change");
  });
});
