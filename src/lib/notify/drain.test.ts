import { describe, expect, it } from "vitest";
import type { StoredSubscription, SubscriptionStore } from "@/lib/push/subscriptions";
import { runRefresh, type RefetchedBook, type RefreshPort } from "@/lib/refresh/run";
import type { BookSnapshot } from "@/lib/refresh/snapshot";
import { drainQueue } from "./drain";
import type { PushPayload } from "./payload";
import type { NotificationQueuePort, QueuedNotification } from "./queue";
import type { PushTransport } from "./send";

const USER_ID = "user-1";
const now = new Date("2026-07-31T00:00:00Z");

/**
 * An in-memory NotificationQueuePort. `claimUnsent` marks rows sent as it
 * returns them, mirroring the real drizzleNotificationQueue's single-
 * statement contract, which is exactly the property "a throwing transport
 * does not leave rows unclaimed for re-sending" needs to be meaningful: if
 * this fake claimed without marking sent, that test would pass for the
 * wrong reason.
 */
function makeQueue(
  rows: Array<{ id: string; kind: string; payload: unknown }>,
): NotificationQueuePort & { rows: QueuedNotification[] } {
  const stored: QueuedNotification[] = rows.map((row) => ({
    id: row.id,
    userId: USER_ID,
    kind: row.kind,
    payload: row.payload,
    createdAt: now,
  }));
  const sent = new Set<string>();

  return {
    rows: stored,
    async enqueue() {
      throw new Error("not used in these tests");
    },
    async claimUnsent(userId) {
      if (userId !== USER_ID) return [];
      const claimable = stored.filter((row) => !sent.has(row.id));
      for (const row of claimable) sent.add(row.id);
      return claimable;
    },
  };
}

function makeSubscription(overrides: Partial<StoredSubscription> = {}): StoredSubscription {
  return {
    id: "sub-1",
    userId: USER_ID,
    endpoint: "https://push.example.com/sub-1",
    p256dh: "p256dh-1",
    auth: "auth-1",
    userAgent: null,
    createdAt: now,
    lastSuccessAt: null,
    lastFailureAt: null,
    failureCount: 0,
    ...overrides,
  };
}

function makeStore(): SubscriptionStore & {
  successes: string[];
  failures: string[];
} {
  return {
    successes: [],
    failures: [],
    async upsert() {
      throw new Error("not used in these tests");
    },
    async remove() {
      /* not used in these tests */
    },
    async listFor() {
      return [];
    },
    async recordSuccess(id) {
      this.successes.push(id);
    },
    async recordFailure(id) {
      this.failures.push(id);
    },
  };
}

function makeTransport(): PushTransport & { sentPayloads: PushPayload[] } {
  return {
    sentPayloads: [],
    async send(_subscription, payload) {
      this.sentPayloads.push(payload);
    },
  };
}

function dateChangeRow(id: string, bookId = "book-1") {
  return {
    id,
    kind: "date_change",
    payload: {
      bookId,
      bookTitle: "A Book",
      from: "2026-01-01",
      to: "2026-03-01",
      fromPrecision: "day",
      toPrecision: "day",
      provider: "hardcover",
    },
  };
}

/**
 * Runs the real runRefresh with a minimal fake RefreshPort and returns
 * whatever it enqueued under "date_change", so a test can feed drainQueue
 * the writer's actual field set instead of a hand-written fixture. This is
 * what pins the run.ts-to-drain.ts contract: if the two shapes ever drift
 * again, this test fails instead of two hand-maintained fixtures quietly
 * staying in sync with each other but not with the real writer.
 */
async function enqueuedDateChangePayload(overrides: {
  before: BookSnapshot;
  after: BookSnapshot;
}): Promise<unknown> {
  const queued: Array<{ kind: string; payload: unknown }> = [];
  const refetched: RefetchedBook = { snapshot: overrides.after, resolution: {} };

  const port: RefreshPort = {
    async candidates() {
      return [{ bookId: overrides.before.bookId, lastRefreshedAt: null, seriesId: null }];
    },
    async currentSnapshot() {
      return overrides.before;
    },
    async refetchSnapshot() {
      return refetched;
    },
    async writeChanges() {},
    async commitRefetched() {
      return overrides.after;
    },
    async markRefreshed() {},
    async enqueue(_userId, kind, payload) {
      queued.push({ kind, payload });
    },
  };

  await runRefresh(port, now);

  const dateChange = queued.find((q) => q.kind === "date_change");
  if (!dateChange) throw new Error("runRefresh did not enqueue a date_change row");
  return dateChange.payload;
}

function baseSnapshot(overrides: Partial<BookSnapshot> = {}): BookSnapshot {
  return {
    bookId: "book-1",
    title: "Withdrawn Book",
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

function digestRow(id: string, bookId = "book-1") {
  return {
    id,
    kind: "digest",
    payload: {
      kind: "upcoming",
      bookTitle: "A Book",
      bookId,
      date: "2026-03-01",
      datePrecision: "day",
    },
  };
}

describe("drainQueue", () => {
  it("is a no-op for an empty queue", async () => {
    const queue = makeQueue([]);
    const transport = makeTransport();
    const store = makeStore();

    const result = await drainQueue({
      userId: USER_ID,
      queue,
      subscriptions: [makeSubscription()],
      transport,
      store,
      now,
    });

    expect(result).toEqual({ claimed: 0, sent: 0, failed: 0 });
    expect(transport.sentPayloads).toEqual([]);
  });

  it("sends one date-change row as one send", async () => {
    const queue = makeQueue([dateChangeRow("row-1")]);
    const transport = makeTransport();
    const store = makeStore();

    const result = await drainQueue({
      userId: USER_ID,
      queue,
      subscriptions: [makeSubscription()],
      transport,
      store,
      now,
    });

    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(transport.sentPayloads).toHaveLength(1);
  });

  it("sends three date-change rows as three individual sends", async () => {
    const queue = makeQueue([
      dateChangeRow("row-1", "book-1"),
      dateChangeRow("row-2", "book-2"),
      dateChangeRow("row-3", "book-3"),
    ]);
    const transport = makeTransport();
    const store = makeStore();

    const result = await drainQueue({
      userId: USER_ID,
      queue,
      subscriptions: [makeSubscription()],
      transport,
      store,
      now,
    });

    expect(result).toEqual({ claimed: 3, sent: 3, failed: 0 });
    expect(transport.sentPayloads).toHaveLength(3);
  });

  it("batches several digest rows into exactly one send", async () => {
    const queue = makeQueue([
      digestRow("row-1", "book-1"),
      digestRow("row-2", "book-2"),
      digestRow("row-3", "book-3"),
    ]);
    const transport = makeTransport();
    const store = makeStore();

    const result = await drainQueue({
      userId: USER_ID,
      queue,
      subscriptions: [makeSubscription()],
      transport,
      store,
      now,
    });

    expect(result).toEqual({ claimed: 3, sent: 1, failed: 0 });
    expect(transport.sentPayloads).toHaveLength(1);
  });

  it("splits a mix into individual date-change sends plus one digest send", async () => {
    const queue = makeQueue([
      dateChangeRow("row-1", "book-1"),
      dateChangeRow("row-2", "book-2"),
      digestRow("row-3", "book-3"),
      digestRow("row-4", "book-4"),
    ]);
    const transport = makeTransport();
    const store = makeStore();

    const result = await drainQueue({
      userId: USER_ID,
      queue,
      subscriptions: [makeSubscription()],
      transport,
      store,
      now,
    });

    expect(result).toEqual({ claimed: 4, sent: 3, failed: 0 });
    expect(transport.sentPayloads).toHaveLength(3);
  });

  it("does not leave rows unclaimed for re-sending when the transport throws", async () => {
    const queue = makeQueue([dateChangeRow("row-1")]);
    const throwingTransport: PushTransport = {
      async send() {
        throw new Error("push service unreachable");
      },
    };
    const store = makeStore();

    const result = await drainQueue({
      userId: USER_ID,
      queue,
      subscriptions: [makeSubscription()],
      transport: throwingTransport,
      store,
      now,
    });

    expect(result).toEqual({ claimed: 1, sent: 0, failed: 1 });
    expect(store.failures).toEqual(["sub-1"]);

    // A second drain must claim nothing: the row was already marked sent by
    // claimUnsent before the throwing send was even attempted.
    const secondResult = await drainQueue({
      userId: USER_ID,
      queue,
      subscriptions: [makeSubscription()],
      transport: throwingTransport,
      store,
      now,
    });
    expect(secondResult).toEqual({ claimed: 0, sent: 0, failed: 0 });
  });

  it("attempts no push when the subscription list is empty", async () => {
    const queue = makeQueue([dateChangeRow("row-1")]);
    const transport = makeTransport();
    const store = makeStore();

    const result = await drainQueue({
      userId: USER_ID,
      queue,
      subscriptions: [],
      transport,
      store,
      now,
    });

    expect(result).toEqual({ claimed: 1, sent: 0, failed: 0 });
    expect(transport.sentPayloads).toEqual([]);
  });

  it("skips a malformed payload row without throwing, counts it as failed, and still sends the rest", async () => {
    const queue = makeQueue([
      { id: "row-1", kind: "date_change", payload: { unexpected: true } },
      dateChangeRow("row-2", "book-2"),
    ]);
    const transport = makeTransport();
    const store = makeStore();

    const result = await drainQueue({
      userId: USER_ID,
      queue,
      subscriptions: [makeSubscription()],
      transport,
      store,
      now,
    });

    expect(result).toEqual({ claimed: 2, sent: 1, failed: 1 });
    expect(transport.sentPayloads).toHaveLength(1);
  });

  // Both rows here carry a WELL-FORMED date-change payload, so a mutation
  // that changes kind dispatch (e.g. `row.kind === "date_change"` becoming
  // `row.kind !== "digest"`) is caught by dispatch itself rather than by the
  // malformed-payload path, which is what let a broken mutant pass before.
  it("skips a row with an unrecognised kind and counts it as failed", async () => {
    const queue = makeQueue([
      { id: "row-1", kind: "digset", payload: dateChangeRow("unused", "book-1").payload },
      dateChangeRow("row-2", "book-2"),
    ]);
    const transport = makeTransport();
    const store = makeStore();

    const result = await drainQueue({
      userId: USER_ID,
      queue,
      subscriptions: [makeSubscription()],
      transport,
      store,
      now,
    });

    expect(result).toEqual({ claimed: 2, sent: 1, failed: 1 });
    expect(transport.sentPayloads).toHaveLength(1);
  });

  // --- End-to-end: a real refresh feeding a real drain ----------------------

  it("drives runRefresh and drainQueue over the same fake queue, proving a real refresh's digest rows are sent as one notification", async () => {
    const queuedRows: Array<{ id: string; kind: string; payload: unknown }> = [];
    let nextId = 0;

    const refreshQueue: NotificationQueuePort = {
      async enqueue(userId, kind, payload) {
        queuedRows.push({ id: `q${nextId++}`, kind, payload });
      },
      async claimUnsent() {
        throw new Error("not used by runRefresh");
      },
    };

    const before1 = baseSnapshot({ bookId: "book-1", title: "First Book", status: "ESTIMATED" });
    const after1 = baseSnapshot({ bookId: "book-1", title: "First Book", status: "RELEASED" });
    const before2 = baseSnapshot({ bookId: "book-2", title: "Second Book", status: "RUMORED" });
    const after2 = baseSnapshot({ bookId: "book-2", title: "Second Book", status: "ANNOUNCED" });

    const snapshots: Record<string, { before: BookSnapshot; after: BookSnapshot }> = {
      "book-1": { before: before1, after: after1 },
      "book-2": { before: before2, after: after2 },
    };

    const refreshPort: RefreshPort = {
      async candidates() {
        return Object.keys(snapshots).map((bookId) => ({
          bookId,
          lastRefreshedAt: null,
          seriesId: null,
        }));
      },
      async currentSnapshot(bookId) {
        return snapshots[bookId].before;
      },
      async refetchSnapshot(bookId) {
        return { snapshot: snapshots[bookId].after, resolution: {} };
      },
      async writeChanges() {},
      async commitRefetched(bookId) {
        return snapshots[bookId].after;
      },
      async markRefreshed() {},
      enqueue: refreshQueue.enqueue,
    };

    const refreshResult = await runRefresh(refreshPort, now);
    expect(refreshResult.failures).toEqual([]);

    // The real writer produced two digest rows, one per book, and no
    // date_change row: neither status move is a release-date move.
    expect(queuedRows.filter((r) => r.kind === "digest")).toHaveLength(2);
    expect(queuedRows.filter((r) => r.kind === "date_change")).toHaveLength(0);

    // Now drain those exact rows through the real drainQueue.
    const drainableQueue = makeQueue(
      queuedRows.map((r) => ({ id: r.id, kind: r.kind, payload: r.payload })),
    );
    const transport = makeTransport();
    const store = makeStore();

    const drainResult = await drainQueue({
      userId: USER_ID,
      queue: drainableQueue,
      subscriptions: [makeSubscription()],
      transport,
      store,
      now,
    });

    // Two claimed digest rows batch into exactly one send.
    expect(drainResult).toEqual({ claimed: 2, sent: 1, failed: 0 });
    expect(transport.sentPayloads).toHaveLength(1);
    expect(transport.sentPayloads[0].body).toContain("First Book");
    expect(transport.sentPayloads[0].body).toContain("Second Book");
  });

  // --- Critical 1 & the writer/reader contract -----------------------------

  it("accepts and sends a date_change row whose provider is null, as diffSnapshots (src/lib/refresh/diff.ts) actually produces on a date withdrawal", async () => {
    const payload = await enqueuedDateChangePayload({
      before: baseSnapshot({ releaseDate: "2027-09-01", datePrecision: "season", sourceProvider: "wikidata" }),
      after: baseSnapshot({ releaseDate: null, datePrecision: null, sourceProvider: null }),
    });

    // The real writer's output carries provider: null for a withdrawal.
    // Sanity-check the fixture actually exercises that case before trusting
    // the assertion below.
    expect((payload as { provider: unknown }).provider).toBeNull();

    const queue = makeQueue([{ id: "row-1", kind: "date_change", payload }]);
    const transport = makeTransport();
    const store = makeStore();

    const result = await drainQueue({
      userId: USER_ID,
      queue,
      subscriptions: [makeSubscription()],
      transport,
      store,
      now,
    });

    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(transport.sentPayloads).toHaveLength(1);
    expect(transport.sentPayloads[0].body).toContain("Withdrawn Book");
  });
});
