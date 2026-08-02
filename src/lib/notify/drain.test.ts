import { describe, expect, it } from "vitest";
import type { StoredSubscription, SubscriptionStore } from "@/lib/push/subscriptions";
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
      from: "2026-01-01",
      to: "2026-03-01",
      fromPrecision: "day",
      toPrecision: "day",
      provider: "hardcover",
    },
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

  it("skips a malformed payload row without throwing and without stopping the rest", async () => {
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

    expect(result).toEqual({ claimed: 2, sent: 1, failed: 0 });
    expect(transport.sentPayloads).toHaveLength(1);
  });

  it("skips a row with an unrecognised kind", async () => {
    const queue = makeQueue([
      { id: "row-1", kind: "digset", payload: { anything: true } },
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

    expect(result).toEqual({ claimed: 2, sent: 1, failed: 0 });
    expect(transport.sentPayloads).toHaveLength(1);
  });
});
