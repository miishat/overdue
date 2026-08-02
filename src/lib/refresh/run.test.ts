import { describe, expect, it } from "vitest";
import type { ChangeRow } from "./diff";
import { runRefresh, type RefetchedBook, type RefreshPort } from "./run";
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

/** Wraps a predicted snapshot as the RefetchedBook shape refetchSnapshot returns. */
function refetched(snapshot: BookSnapshot, resolution: unknown = {}): RefetchedBook {
  return { snapshot, resolution };
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
      return refetched(snap(bookId));
    },
    async writeChanges(rows) {
      recorded.writeCalls += 1;
      recorded.written.push(...rows);
    },
    async commitRefetched(bookId) {
      recorded.committed.push(bookId);
      // By default, the commit produces exactly the snapshot that was
      // predicted, so no correction row is generated.
      return snap(bookId);
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
    async commitRefetched(bookId, resolution, now) {
      recorded.calls.push(`commitRefetched:${bookId}`);
      return base.commitRefetched(bookId, resolution, now);
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
        return refetched(snap(bookId, { releaseDate: "2028-01-15" }));
      },
      async commitRefetched(bookId) {
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
        return refetched(snap(bookId, { releaseDate: "2028-01-15" }));
      },
      async commitRefetched(bookId) {
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
    // commitRefetched must also not be called: there is no resolution to
    // commit for this book.
    expect(recorded.committed).toEqual([]);
    expect(recorded.marked).toEqual(["b1"]);
  });

  it("does not mark refreshed when writeChanges throws before markRefreshed runs", async () => {
    const { port: p, recorded } = port({
      async refetchSnapshot(bookId) {
        return refetched(snap(bookId, { releaseDate: "2028-01-15" }));
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
        return refetched(snap(bookId, { releaseDate: "2028-01-15" }));
      },
      async commitRefetched(bookId) {
        return snap(bookId, { releaseDate: "2028-01-15" });
      },
    });

    await runRefresh(p, NOW);

    // The whole point of the ordering: every read and diff happens first, the
    // append-only history is written next, only then is anyone told about it,
    // and only then are the old values made unobservable by the write-back.
    // Since the commit here matches the prediction exactly, no correction
    // writeChanges call happens, so markRefreshed follows directly.
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
        return refetched(snap(bookId, { releaseDate: "2028-01-15" }));
      },
      async commitRefetched(bookId) {
        recorded.committed.push(bookId);
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
        return refetched(snap(bookId, { releaseDate: "2028-01-15" }));
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
        return refetched(snap(bookId, { releaseDate: "2028-01-15" }));
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
        return refetched(snap(bookId, { releaseDate: "2028-01-15" }));
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
        return refetched(snap(bookId, { releaseDate: "2028-01-15" }));
      },
      async commitRefetched(bookId) {
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
        return refetched(snap(bookId, { title: "Renamed" }));
      },
      async commitRefetched(bookId) {
        return snap(bookId, { title: "Renamed" });
      },
    });

    await runRefresh(p, NOW);

    expect(recorded.queued.map((q) => q.kind)).not.toContain("date_change");
  });

  // --- Digest enqueue ---------------------------------------------------

  it("enqueues a digest row when status moves to RELEASED", async () => {
    const { port: p, recorded } = port({
      async refetchSnapshot(bookId) {
        return refetched(snap(bookId, { status: "RELEASED" }));
      },
      async commitRefetched(bookId) {
        return snap(bookId, { status: "RELEASED" });
      },
    });

    const result = await runRefresh(p, NOW);

    expect(result.failures).toEqual([]);
    const digestRows = recorded.queued.filter((q) => q.kind === "digest");
    expect(digestRows).toHaveLength(1);
    expect(digestRows[0].payload).toEqual({
      kind: "released_today",
      bookId: "b1",
      bookTitle: "A Book",
      date: "2027-09-01",
      datePrecision: "season",
    });
  });

  it("enqueues a digest row when status moves to ANNOUNCED", async () => {
    const { port: p, recorded } = port({
      async currentSnapshot(bookId) {
        return snap(bookId, { status: "RUMORED" });
      },
      async refetchSnapshot(bookId) {
        return refetched(snap(bookId, { status: "ANNOUNCED" }));
      },
      async commitRefetched(bookId) {
        return snap(bookId, { status: "ANNOUNCED" });
      },
    });

    const result = await runRefresh(p, NOW);

    expect(result.failures).toEqual([]);
    const digestRows = recorded.queued.filter((q) => q.kind === "digest");
    expect(digestRows).toHaveLength(1);
    expect((digestRows[0].payload as { kind: string }).kind).toBe("announced");
  });

  it("does not enqueue a digest row for a status move that has no digest wording", async () => {
    const { port: p, recorded } = port({
      async currentSnapshot(bookId) {
        return snap(bookId, { status: "RUMORED" });
      },
      async refetchSnapshot(bookId) {
        return refetched(snap(bookId, { status: "EXPECTED" }));
      },
      async commitRefetched(bookId) {
        return snap(bookId, { status: "EXPECTED" });
      },
    });

    await runRefresh(p, NOW);

    expect(recorded.queued.map((q) => q.kind)).not.toContain("digest");
  });

  it("does not enqueue a digest row for a cosmetic field change (coverUrl)", async () => {
    const { port: p, recorded } = port({
      async refetchSnapshot(bookId) {
        return refetched(snap(bookId, { coverUrl: "https://example.com/new.jpg" }));
      },
      async commitRefetched(bookId) {
        return snap(bookId, { coverUrl: "https://example.com/new.jpg" });
      },
    });

    await runRefresh(p, NOW);

    expect(recorded.queued.map((q) => q.kind)).not.toContain("digest");
  });

  it("does not also enqueue a digest row for a plain date move (already an instant alert)", async () => {
    const { port: p, recorded } = port({
      async refetchSnapshot(bookId) {
        return refetched(snap(bookId, { releaseDate: "2028-01-15" }));
      },
      async commitRefetched(bookId) {
        return snap(bookId, { releaseDate: "2028-01-15" });
      },
    });

    await runRefresh(p, NOW);

    expect(recorded.queued.map((q) => q.kind)).toEqual(["date_change"]);
  });

  it("includes the book title in the digest payload", async () => {
    const { port: p, recorded } = port({
      async refetchSnapshot(bookId) {
        return refetched(snap(bookId, { status: "RELEASED", title: "Named Book" }));
      },
      async commitRefetched(bookId) {
        return snap(bookId, { status: "RELEASED", title: "Named Book" });
      },
    });

    await runRefresh(p, NOW);

    const digestRow = recorded.queued.find((q) => q.kind === "digest");
    expect((digestRow?.payload as { bookTitle: string }).bookTitle).toBe("Named Book");
  });

  it("does not enqueue a digest row when nothing changed", async () => {
    const { port: p, recorded } = port();
    await runRefresh(p, NOW);
    expect(recorded.queued.map((q) => q.kind)).not.toContain("digest");
  });

  it("does not commit or mark a book whose digest row could not be queued", async () => {
    const { port: p, recorded } = port({
      async refetchSnapshot(bookId) {
        return refetched(snap(bookId, { status: "RELEASED" }));
      },
      async enqueue(_userId, kind) {
        if (kind === "digest") throw new Error("queue unavailable");
      },
    });

    const result = await runRefresh(p, NOW);

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toBe("queue unavailable");
    expect(recorded.committed).toEqual([]);
    expect(recorded.marked).toEqual([]);
  });

  // --- Important 1: predicted-vs-actual correction --------------------------

  it("writes a correcting change_log row when the commit's actual snapshot diverges from the prediction", async () => {
    // The predicted snapshot (what phase 1 diffed against `before`) says the
    // series stays null, exactly the failure mode that motivated this fix:
    // predictSnapshot cannot see a series upsertSeries is about to INSERT.
    // The port's commit, however, returns the real post-commit snapshot with
    // a series id now attached. That divergence must produce its own
    // change_log row rather than being silently lost.
    const { port: p, recorded } = port({
      async refetchSnapshot(bookId) {
        return refetched(snap(bookId, { seriesId: null }));
      },
      async commitRefetched(bookId) {
        return snap(bookId, { seriesId: "series-1" });
      },
    });

    const result = await runRefresh(p, NOW);

    expect(result.failures).toEqual([]);
    // No diff between before and predicted (both seriesId: null), so no rows
    // from phase 1. The correction is the only row, from phase 5.
    expect(recorded.written).toHaveLength(1);
    expect(recorded.written[0].field).toBe("series_id");
    expect(recorded.written[0].oldValue).toBeNull();
    expect(recorded.written[0].newValue).toBe("series-1");
    expect(result.changeRows).toBe(1);
    // Two separate writeChanges calls: the (empty, skipped) phase-2 call
    // never fires since rows.length was 0 there, and the phase-5 correction
    // call does. commitRefetched must run before this correction is written.
    expect(recorded.calls.indexOf("commitRefetched:b1")).toBeLessThan(
      recorded.calls.lastIndexOf("writeChanges"),
    );
    expect(recorded.marked).toEqual(["b1"]);
  });

  it("writes no correction row when the commit's actual snapshot matches the prediction", async () => {
    const { port: p, recorded } = port({
      async refetchSnapshot(bookId) {
        return refetched(snap(bookId, { releaseDate: "2028-01-15" }));
      },
      async commitRefetched(bookId) {
        return snap(bookId, { releaseDate: "2028-01-15" });
      },
    });

    const result = await runRefresh(p, NOW);

    // Exactly the one row from phase 1's diff, nothing extra from phase 5.
    expect(recorded.written).toHaveLength(1);
    expect(result.changeRows).toBe(1);
    expect(recorded.writeCalls).toBe(1);
  });

  it("does not mark refreshed when the correcting writeChanges call throws", async () => {
    const { port: p, recorded } = port({
      async refetchSnapshot(bookId) {
        return refetched(snap(bookId, { seriesId: null }));
      },
      async commitRefetched(bookId) {
        return snap(bookId, { seriesId: "series-1" });
      },
      async writeChanges(rows) {
        recorded.writeCalls += 1;
        recorded.written.push(...rows);
        if (rows.some((r) => r.field === "series_id")) {
          throw new Error("correction write failed");
        }
      },
    });

    await expect(runRefresh(p, NOW)).rejects.toThrow("correction write failed");
    // The commit already happened (real values are live in the DB) but the
    // correcting history row failed to persist, so the book must not be
    // marked refreshed: it stays near the front of the queue instead of
    // being rotated away with an unrecorded change.
    expect(recorded.marked).toEqual([]);
  });

  // --- Important 2: reentrancy / no module-level state -----------------------

  it("carries resolution through the return value so two concurrent runs cannot clobber each other", async () => {
    // Simulates two overlapping runs on the same instance by driving two
    // independent runRefresh calls whose ports share no module-level state,
    // only local closures. If the port relied on a module-level Map keyed by
    // bookId, the interleaving below would have run B's write clobber run A's
    // pending resolution (or vice versa). Since resolution now flows solely
    // through RefetchedBook's return value, each run's own predicted snapshot
    // and resolution stay intact regardless of what any other run is doing.
    const commitsSeen: string[] = [];

    function makeConcurrentPort(bookId: string, marker: string) {
      return port({
        async candidates() {
          return [{ bookId, lastRefreshedAt: null, seriesId: null }];
        },
        async refetchSnapshot(id) {
          return refetched(
            snap(id, { title: `Renamed by ${marker}` }),
            { marker },
          );
        },
        async commitRefetched(id, resolution) {
          const typed = resolution as { marker: string };
          commitsSeen.push(typed.marker);
          return snap(id, { title: `Renamed by ${typed.marker}` });
        },
      });
    }

    const runA = makeConcurrentPort("b1", "A");
    const runB = makeConcurrentPort("b1", "B");

    // Interleave: both runs read/diff before either commits, exactly the
    // ordering that would previously corrupt a module-level Map.
    const [resultA, resultB] = await Promise.all([
      runRefresh(runA.port, NOW),
      runRefresh(runB.port, NOW),
    ]);

    expect(resultA.failures).toEqual([]);
    expect(resultB.failures).toEqual([]);
    // Each run committed its OWN resolution, not the other's.
    expect(commitsSeen.sort()).toEqual(["A", "B"]);
    expect(runA.recorded.calls).toContain("commitRefetched:b1");
    expect(runB.recorded.calls).toContain("commitRefetched:b1");
  });

  it("propagates a hard failure rather than silently succeeding when the port has nothing to commit", async () => {
    // Models the old module-level-Map bug directly: a port whose commit
    // cannot find a resolution for the bookId it was asked about must throw,
    // not return quietly. A quiet return there previously let runRefresh mark
    // a book refreshed and count it committed for a write that never
    // happened.
    const { port: p, recorded } = port({
      async refetchSnapshot(bookId) {
        return refetched(snap(bookId, { releaseDate: "2028-01-15" }));
      },
      async commitRefetched() {
        throw new Error(
          "refresh write-back for book b1 was given no resolution to commit",
        );
      },
    });

    const result = await runRefresh(p, NOW);

    expect(result.failures).toEqual([
      {
        bookId: "b1",
        reason:
          "refresh write-back for book b1 was given no resolution to commit",
      },
    ]);
    expect(recorded.marked).toEqual([]);
  });
});
