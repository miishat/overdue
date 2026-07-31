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
  committed: string[];
  writeCalls: number;
  markCalls: number;
  /** Every port call in the order it happened, for ordering assertions. */
  calls: string[];
}

function port(
  overrides: Partial<RefreshPort> = {},
): { port: RefreshPort; recorded: Recorded } {
  const recorded: Recorded = {
    written: [],
    marked: [],
    queued: [],
    committed: [],
    writeCalls: 0,
    markCalls: 0,
    calls: [],
  };

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
      recorded.writeCalls += 1;
      recorded.written.push(...rows);
    },
    async commitRefetched(bookId) {
      recorded.committed.push(bookId);
    },
    async markRefreshed(bookIds) {
      recorded.markCalls += 1;
      recorded.marked.push(...bookIds);
    },
    async enqueue(_userId, kind, payload) {
      recorded.queued.push({ kind, payload });
    },
    ...overrides,
  };

  // Wrap after the overrides so the log records the port runRefresh actually
  // sees, whichever implementation of each method is in play.
  const logged: RefreshPort = {
    candidates: base.candidates.bind(base),
    async currentSnapshot(bookId, now) {
      recorded.calls.push(`currentSnapshot:${bookId}`);
      return base.currentSnapshot(bookId, now);
    },
    async refetchSnapshot(bookId, now) {
      recorded.calls.push(`refetchSnapshot:${bookId}`);
      return base.refetchSnapshot(bookId, now);
    },
    async writeChanges(rows) {
      recorded.calls.push("writeChanges");
      return base.writeChanges(rows);
    },
    async commitRefetched(bookId) {
      recorded.calls.push(`commitRefetched:${bookId}`);
      return base.commitRefetched(bookId);
    },
    async markRefreshed(bookIds, at) {
      recorded.calls.push("markRefreshed");
      return base.markRefreshed(bookIds, at);
    },
    async enqueue(userId, kind, payload) {
      recorded.calls.push(`enqueue:${kind}`);
      return base.enqueue(userId, kind, payload);
    },
  };

  return { port: logged, recorded };
}

describe("runRefresh", () => {
  it("writes nothing when nothing changed", async () => {
    const { port: p, recorded } = port();
    const result = await runRefresh(p, NOW);

    expect(result.examined).toBe(1);
    expect(result.changed).toBe(0);
    expect(result.changeRows).toBe(0);
    expect(result.failures).toEqual([]);
    expect(recorded.written).toEqual([]);
    expect(recorded.writeCalls).toBe(0);
    expect(recorded.queued).toEqual([]);
  });

  it("is idempotent: a second identical run still writes nothing", async () => {
    const { port: p, recorded } = port();
    await runRefresh(p, NOW);
    await runRefresh(p, NOW);
    expect(recorded.written).toEqual([]);
    expect(recorded.writeCalls).toBe(0);
  });

  it("writes a change row when a date moved", async () => {
    const { port: p, recorded } = port({
      async refetchSnapshot(bookId) {
        return snap(bookId, { releaseDate: "2028-01-15" });
      },
    });

    const result = await runRefresh(p, NOW);

    expect(result.changed).toBe(1);
    expect(result.changeRows).toBe(recorded.written.length);
    expect(result.failures).toEqual([]);
    expect(recorded.written).toHaveLength(1);
    expect(recorded.written[0].field).toBe("release_date");
    expect(recorded.writeCalls).toBe(1);
  });

  it("marks a successfully refreshed book", async () => {
    const { port: p, recorded } = port();
    await runRefresh(p, NOW);
    expect(recorded.marked).toEqual(["b1"]);
    expect(recorded.markCalls).toBe(1);
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
    expect(result.failures[0].reason).toBe("provider exploded");
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
    // No current snapshot means nothing to diff against, so the book is
    // deliberately NOT considered refreshed. This is the asymmetric half of
    // the null-snapshot behaviour: contrast with the refetch-null case below.
    expect(recorded.marked).toEqual([]);
  });

  it("skips a book the providers no longer return", async () => {
    const { port: p, recorded } = port({
      async refetchSnapshot() {
        return null;
      },
    });

    await runRefresh(p, NOW);

    expect(recorded.written).toEqual([]);
    // Providers no longer returning the book is not treated as an error: the
    // book IS marked refreshed, unlike the no-current-snapshot case above.
    expect(recorded.marked).toEqual(["b1"]);
  });

  it("does not mark refreshed when writeChanges throws before markRefreshed runs", async () => {
    const { port: p, recorded } = port({
      async refetchSnapshot(bookId) {
        return snap(bookId, { releaseDate: "2028-01-15" });
      },
      async writeChanges() {
        throw new Error("write failed");
      },
    });

    await expect(runRefresh(p, NOW)).rejects.toThrow("write failed");
    // writeChanges must run before markRefreshed. If it throws, the book must
    // not be marked refreshed, or it would be skipped next run despite its
    // changes never having been persisted.
    expect(recorded.marked).toEqual([]);
    // And the new values must NOT have been committed. If they had been, the
    // next run would read them back as current, diff to nothing, and the date
    // move would have no change_log row ever: permanently lost history.
    expect(recorded.committed).toEqual([]);
    expect(recorded.calls).not.toContain("commitRefetched:b1");
  });

  it("orders the run history, alerts, write-back, mark", async () => {
    const { port: p, recorded } = port({
      async refetchSnapshot(bookId) {
        return snap(bookId, { releaseDate: "2028-01-15" });
      },
    });

    await runRefresh(p, NOW);

    // The whole point of the ordering: every read and diff happens first, the
    // append-only history is written next, only then is anyone told about it,
    // and only then are the old values made unobservable by the write-back.
    expect(recorded.calls).toEqual([
      "currentSnapshot:b1",
      "refetchSnapshot:b1",
      "writeChanges",
      "enqueue:date_change",
      "commitRefetched:b1",
      "markRefreshed",
    ]);
  });

  it("diffs the whole slice before writing anything", async () => {
    const { port: p, recorded } = port({
      async candidates() {
        return [
          { bookId: "b1", lastRefreshedAt: null, seriesId: null },
          { bookId: "b2", lastRefreshedAt: null, seriesId: null },
        ];
      },
      async refetchSnapshot(bookId) {
        return snap(bookId, { releaseDate: "2028-01-15" });
      },
    });

    await runRefresh(p, NOW);

    // b2 must be read against its UNCOMMITTED stored state. A per-book commit
    // inside the loop would interleave here.
    expect(recorded.calls.slice(0, 5)).toEqual([
      "currentSnapshot:b1",
      "refetchSnapshot:b1",
      "currentSnapshot:b2",
      "refetchSnapshot:b2",
      "writeChanges",
    ]);
    expect(recorded.committed).toEqual(["b1", "b2"]);
  });

  it("records a failure and does not mark refreshed when the write-back fails", async () => {
    const { port: p, recorded } = port({
      async refetchSnapshot(bookId) {
        return snap(bookId, { releaseDate: "2028-01-15" });
      },
      async commitRefetched() {
        throw new Error("write-back rejected");
      },
    });

    const result = await runRefresh(p, NOW);

    // The deliberate trade: the change_log row is already written, so the book
    // is left unmarked and the next run recomputes the same diff and writes a
    // duplicate row. A duplicate history row is recoverable; a missing one is
    // not.
    expect(recorded.written).toHaveLength(1);
    expect(result.failures).toEqual([
      { bookId: "b1", reason: "write-back rejected" },
    ]);
    expect(recorded.marked).toEqual([]);
  });

  it("does not commit or mark a book whose alert could not be queued", async () => {
    const { port: p, recorded } = port({
      async refetchSnapshot(bookId) {
        return snap(bookId, { releaseDate: "2028-01-15" });
      },
      async enqueue() {
        throw new Error("queue unavailable");
      },
    });

    await runRefresh(p, NOW);

    expect(recorded.written).toHaveLength(1);
    expect(recorded.committed).toEqual([]);
    expect(recorded.marked).toEqual([]);
  });

  it("records a failure and still writes prior rows when enqueue throws", async () => {
    const { port: p, recorded } = port({
      async candidates() {
        return [
          { bookId: "b1", lastRefreshedAt: null, seriesId: null },
          { bookId: "b2", lastRefreshedAt: null, seriesId: null },
        ];
      },
      async refetchSnapshot(bookId) {
        return snap(bookId, { releaseDate: "2028-01-15" });
      },
      async enqueue() {
        throw new Error("queue unavailable");
      },
    });

    const result = await runRefresh(p, NOW);

    // The current behaviour: an enqueue failure for a book fails that whole
    // book's iteration, so it lands in failures and is not marked refreshed,
    // but its diff rows were already pushed to the pending rows array before
    // enqueue ran, so they are still written.
    expect(result.failures).toHaveLength(2);
    expect(result.failures.map((f) => f.bookId)).toEqual(["b1", "b2"]);
    expect(result.failures[0].reason).toBe("queue unavailable");
    expect(recorded.marked).toEqual([]);
    expect(recorded.written).toHaveLength(2);
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

    const result = await runRefresh(p, NOW);

    expect(result.failures).toEqual([]);
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
