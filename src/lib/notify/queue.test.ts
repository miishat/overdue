import { describe, expect, it, beforeAll } from "vitest";
import type { NotificationQueuePort, QueuedNotification as QueuedNotificationType } from "./queue";

// db/client.ts throws if DATABASE_URL is unset at import time. neon() only
// builds a lazy query function at construction time and does not connect,
// so a placeholder here lets a dynamic import load the real queue module
// without ever touching a real database. The import must be dynamic
// (deferred past this assignment) because a static import would be hoisted
// above it.
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";

let buildClaimUnsentStatement: typeof import("./queue").buildClaimUnsentStatement;

beforeAll(async () => {
  ({ buildClaimUnsentStatement } = await import("./queue"));
});

// The contract behaviour (enqueue writes an unsent row, claiming returns
// only unsent rows and marks them sent, claiming twice yields nothing the
// second time, claiming an empty queue is safe) is exercised here against
// an in-memory implementation of NotificationQueuePort. There is no real
// database in this test suite (per the milestone's testing strategy), so
// this in-memory store stands in for drizzleNotificationQueue's contract.
// The single-statement atomicity that the real Drizzle implementation
// relies on for retry safety cannot be proven by any fake store, since a
// fake can trivially "cheat" by doing a select-then-update in two steps
// and still pass every contract test above; that property is proven
// separately below via `.toSQL()` on the real query builder.
function makeInMemoryQueue(): NotificationQueuePort & {
  rows: Array<{ id: string; userId: string; kind: string; payload: unknown; createdAt: Date; sentAt: Date | null }>;
} {
  let nextId = 1;
  const rows: Array<{
    id: string;
    userId: string;
    kind: string;
    payload: unknown;
    createdAt: Date;
    sentAt: Date | null;
  }> = [];

  return {
    rows,
    async enqueue(userId, kind, payload) {
      rows.push({
        id: `row-${nextId++}`,
        userId,
        kind,
        payload,
        createdAt: new Date(),
        sentAt: null,
      });
    },
    async claimUnsent(userId, now) {
      const claimed: QueuedNotificationType[] = [];
      for (const row of rows) {
        if (row.userId === userId && row.sentAt === null) {
          row.sentAt = now;
          claimed.push({
            id: row.id,
            userId: row.userId,
            kind: row.kind,
            payload: row.payload,
            createdAt: row.createdAt,
          });
        }
      }
      return claimed;
    },
  };
}

const userId = "11111111-1111-1111-1111-111111111111";
const otherUserId = "22222222-2222-2222-2222-222222222222";
const now = new Date("2026-07-31T00:00:00Z");

describe("NotificationQueuePort contract", () => {
  it("enqueue writes an unsent row", async () => {
    const queue = makeInMemoryQueue();
    await queue.enqueue(userId, "date_change", { bookId: "book-1" });

    expect(queue.rows).toHaveLength(1);
    expect(queue.rows[0]).toMatchObject({
      userId,
      kind: "date_change",
      payload: { bookId: "book-1" },
      sentAt: null,
    });
  });

  it("claiming returns only unsent rows, scoped to the user", async () => {
    const queue = makeInMemoryQueue();
    await queue.enqueue(userId, "date_change", { bookId: "book-1" });
    await queue.enqueue(otherUserId, "date_change", { bookId: "book-2" });
    // Mark one of this user's rows already sent, out of band.
    queue.rows[0].sentAt = new Date("2026-07-30T00:00:00Z");
    await queue.enqueue(userId, "digest", { count: 3 });

    const claimed = await queue.claimUnsent(userId, now);

    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ userId, kind: "digest", payload: { count: 3 } });
  });

  it("claiming marks rows sent so a second claim returns nothing", async () => {
    const queue = makeInMemoryQueue();
    await queue.enqueue(userId, "date_change", { bookId: "book-1" });

    const first = await queue.claimUnsent(userId, now);
    const second = await queue.claimUnsent(userId, now);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect(queue.rows[0].sentAt).toEqual(now);
  });

  it("claiming an empty queue is safe", async () => {
    const queue = makeInMemoryQueue();

    const claimed = await queue.claimUnsent(userId, now);

    expect(claimed).toEqual([]);
  });
});

// Proves the real Drizzle claim is a single UPDATE ... RETURNING statement,
// not a SELECT followed by an UPDATE. `.toSQL()` compiles the statement
// without executing it, so this touches no database. This is the property
// that makes a retry safe: with one statement there is no window between
// reading unsent rows and marking them sent for a crash, or an overlapping
// drain, to land in and claim the same row twice.
describe("buildClaimUnsentStatement", () => {
  it("compiles to a single UPDATE with a RETURNING clause", () => {
    const { sql } = buildClaimUnsentStatement(userId, now).toSQL();

    expect(sql).toMatch(/^update\s+"notification_queue"/i);
    expect(sql).toMatch(/\breturning\b/i);
    // Only one statement: no semicolon-separated second statement, and no
    // "select" keyword anywhere, which would indicate a two-step claim.
    expect(sql).not.toMatch(/select/i);
  });

  it("scopes the claim to the given user and only unsent rows", () => {
    const { sql, params } = buildClaimUnsentStatement(userId, now).toSQL();

    expect(sql).toMatch(/"user_id" = \$\d+/);
    expect(sql).toMatch(/"sent_at" is null/i);
    expect(params).toContain(userId);
  });

  it("sets sent_at to the provided now", () => {
    const { sql, params } = buildClaimUnsentStatement(userId, now).toSQL();

    expect(sql).toMatch(/set\s+"sent_at" = \$\d+/i);
    expect(params).toContainEqual(now.toISOString());
  });
});
