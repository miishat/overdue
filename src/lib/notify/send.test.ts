import { describe, expect, it } from "vitest";
import { WebPushError } from "web-push";
import { sendToAll, type PushTransport } from "./send";
import type { StoredSubscription, SubscriptionStore } from "@/lib/push/subscriptions";
import type { PushPayload } from "./payload";

// A fake store, never touches a database. sendToAll is exercised entirely
// against fakes here per the milestone's testing strategy: no real sends,
// no real database, in these tests.
function makeFakeStore(): SubscriptionStore & {
  successes: Array<{ id: string; at: Date }>;
  failures: Array<{ id: string; at: Date }>;
  removed: Array<{ userId: string; endpoint: string }>;
} {
  return {
    successes: [],
    failures: [],
    removed: [],
    async upsert() {
      throw new Error("not used in these tests");
    },
    async remove(userId, endpoint) {
      this.removed.push({ userId, endpoint });
    },
    async listFor() {
      return [];
    },
    async recordSuccess(id, at) {
      this.successes.push({ id, at });
    },
    async recordFailure(id, at) {
      this.failures.push({ id, at });
    },
  };
}

function makeSubscription(overrides: Partial<StoredSubscription> = {}): StoredSubscription {
  return {
    id: "sub-1",
    userId: "user-1",
    endpoint: "https://push.example.com/sub-1",
    p256dh: "p256dh-1",
    auth: "auth-1",
    userAgent: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastSuccessAt: null,
    lastFailureAt: null,
    failureCount: 0,
    ...overrides,
  };
}

const payload: PushPayload = { title: "A book moved" };
const now = new Date("2026-07-31T00:00:00Z");

function webPushErrorWithStatus(statusCode: number): WebPushError {
  return new WebPushError("push service error", statusCode, {}, "body", "https://push.example.com/x");
}

describe("sendToAll", () => {
  it("sends to every subscription and records success on each when all succeed", async () => {
    const subscriptions = [
      makeSubscription({ id: "sub-1", endpoint: "https://push.example.com/1" }),
      makeSubscription({ id: "sub-2", endpoint: "https://push.example.com/2" }),
    ];
    const store = makeFakeStore();
    const sent: string[] = [];
    const transport: PushTransport = {
      async send(subscription) {
        sent.push(subscription.id);
      },
    };

    const result = await sendToAll({ subscriptions, payload, transport, store, now });

    expect(result).toEqual({ sent: 2, failed: 0, removed: 0 });
    expect(sent).toEqual(["sub-1", "sub-2"]);
    expect(store.successes.map((s) => s.id)).toEqual(["sub-1", "sub-2"]);
  });

  it("isolates one failing subscription so the rest still send", async () => {
    const subscriptions = [
      makeSubscription({ id: "sub-1" }),
      makeSubscription({ id: "sub-2" }),
      makeSubscription({ id: "sub-3" }),
    ];
    const store = makeFakeStore();
    const transport: PushTransport = {
      async send(subscription) {
        if (subscription.id === "sub-2") {
          throw webPushErrorWithStatus(500);
        }
      },
    };

    const result = await sendToAll({ subscriptions, payload, transport, store, now });

    expect(result).toEqual({ sent: 2, failed: 1, removed: 0 });
    expect(store.successes.map((s) => s.id)).toEqual(["sub-1", "sub-3"]);
    expect(store.failures.map((f) => f.id)).toEqual(["sub-2"]);
  });

  it("removes the subscription on a 404", async () => {
    const subscription = makeSubscription({
      id: "sub-1",
      userId: "user-1",
      endpoint: "https://push.example.com/gone",
    });
    const store = makeFakeStore();
    const transport: PushTransport = {
      async send() {
        throw webPushErrorWithStatus(404);
      },
    };

    const result = await sendToAll({ subscriptions: [subscription], payload, transport, store, now });

    expect(result).toEqual({ sent: 0, failed: 0, removed: 1 });
    expect(store.removed).toEqual([{ userId: "user-1", endpoint: "https://push.example.com/gone" }]);
    expect(store.failures).toEqual([]);
  });

  it("removes the subscription on a 410", async () => {
    const subscription = makeSubscription({
      id: "sub-1",
      userId: "user-1",
      endpoint: "https://push.example.com/expired",
    });
    const store = makeFakeStore();
    const transport: PushTransport = {
      async send() {
        throw webPushErrorWithStatus(410);
      },
    };

    const result = await sendToAll({ subscriptions: [subscription], payload, transport, store, now });

    expect(result).toEqual({ sent: 0, failed: 0, removed: 1 });
    expect(store.removed).toEqual([{ userId: "user-1", endpoint: "https://push.example.com/expired" }]);
    expect(store.failures).toEqual([]);
  });

  it("records a failure without removing on a 500", async () => {
    const subscription = makeSubscription({ id: "sub-1" });
    const store = makeFakeStore();
    const transport: PushTransport = {
      async send() {
        throw webPushErrorWithStatus(500);
      },
    };

    const result = await sendToAll({ subscriptions: [subscription], payload, transport, store, now });

    expect(result).toEqual({ sent: 0, failed: 1, removed: 0 });
    expect(store.failures).toEqual([{ id: "sub-1", at: now }]);
    expect(store.removed).toEqual([]);
  });

  it("resets a previously non-zero failureCount on success", async () => {
    const subscription = makeSubscription({ id: "sub-1", failureCount: 3 });
    const store = makeFakeStore();
    const transport: PushTransport = {
      async send() {
        // succeeds
      },
    };

    await sendToAll({ subscriptions: [subscription], payload, transport, store, now });

    // recordSuccess is the store method responsible for the reset; sendToAll
    // must call it on the successful subscription regardless of its prior
    // failureCount value.
    expect(store.successes).toEqual([{ id: "sub-1", at: now }]);
    expect(store.failures).toEqual([]);
  });

  it("is a no-op returning zeroes for an empty subscription list", async () => {
    const store = makeFakeStore();
    let sendCalls = 0;
    const transport: PushTransport = {
      async send() {
        sendCalls += 1;
      },
    };

    const result = await sendToAll({ subscriptions: [], payload, transport, store, now });

    expect(result).toEqual({ sent: 0, failed: 0, removed: 0 });
    expect(sendCalls).toBe(0);
  });

  it("never throws regardless of what the transport does", async () => {
    const subscriptions = [makeSubscription({ id: "sub-1" })];
    const store = makeFakeStore();
    const transport: PushTransport = {
      async send() {
        throw new TypeError("completely unexpected transport failure");
      },
    };

    await expect(
      sendToAll({ subscriptions, payload, transport, store, now }),
    ).resolves.toEqual({ sent: 0, failed: 1, removed: 0 });
  });

  it("returns zeroes without attempting anything when transport is null (VAPID not configured)", async () => {
    const subscriptions = [makeSubscription({ id: "sub-1" })];
    const store = makeFakeStore();

    const result = await sendToAll({ subscriptions, payload, transport: null, store, now });

    expect(result).toEqual({ sent: 0, failed: 0, removed: 0 });
    expect(store.successes).toEqual([]);
    expect(store.failures).toEqual([]);
    expect(store.removed).toEqual([]);
  });
});
