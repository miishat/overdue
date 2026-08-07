import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// db/client.ts throws if DATABASE_URL is unset. port.ts imports it
// transitively, so a placeholder here lets the route import cleanly without
// ever touching a real database.
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";

const candidates = vi.fn(async () => []);
const currentSnapshot = vi.fn(async () => null);
const refetchSnapshot = vi.fn(async () => null);
const writeChanges = vi.fn(async () => undefined);
const commitRefetched = vi.fn(async () => undefined);
const markRefreshed = vi.fn(async () => undefined);
const enqueue = vi.fn(async () => undefined);

vi.mock("@/lib/refresh/port", () => ({
  drizzleRefreshPort: {
    candidates,
    currentSnapshot,
    refetchSnapshot,
    writeChanges,
    commitRefetched,
    markRefreshed,
    enqueue,
  },
}));
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn(async () => "u1"),
  LOCAL_USER_ID: "u1",
}));

// Tracks call order across the refresh port and the drain, so a test can
// prove the drain runs strictly after the refresh rather than merely that
// both ran at some point.
const callOrder: string[] = [];

const drainQueue = vi.fn(async () => ({ claimed: 0, sent: 0, failed: 0 }));
vi.mock("@/lib/notify/drain", () => ({
  drainQueue,
}));

vi.mock("@/lib/notify/queue", () => ({
  drizzleNotificationQueue: {},
}));

const listFor = vi.fn(async () => []);
vi.mock("@/lib/push/subscriptions", () => ({
  drizzleSubscriptionStore: { listFor },
}));

// A fake transport, truthy, so runDrain proceeds to call drainQueue instead
// of short-circuiting on push-not-configured (the real createWebPushTransport
// returns null without VAPID env vars, which every test here leaves unset).
const createWebPushTransport = vi.fn(() => ({ send: vi.fn() }));
vi.mock("@/lib/notify/send", () => ({
  createWebPushTransport,
}));

const SECRET = "test-cron-secret-value";

function post(headers?: Record<string, string>) {
  return import("./route").then(({ POST }) =>
    POST(
      new Request("http://localhost/api/refresh", {
        method: "POST",
        headers,
      }),
    ),
  );
}

function get() {
  return import("./route").then(({ GET }) => GET());
}

describe("POST /api/refresh", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    callOrder.length = 0;
    candidates.mockImplementation(async () => {
      callOrder.push("refresh:candidates");
      return [];
    });
    drainQueue.mockImplementation(async () => {
      callOrder.push("drain:drainQueue");
      return { claimed: 0, sent: 0, failed: 0 };
    });
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalSecret;
    }
  });

  it("returns 401 and never calls the port when no Authorization header is present", async () => {
    process.env.CRON_SECRET = SECRET;

    const res = await post();

    expect(res.status).toBe(401);
    expect(candidates).not.toHaveBeenCalled();
  });

  it("returns 401 and never calls the port for a wrong secret", async () => {
    process.env.CRON_SECRET = SECRET;

    const res = await post({ Authorization: "Bearer wrong-secret-value" });

    expect(res.status).toBe(401);
    expect(candidates).not.toHaveBeenCalled();
  });

  it("returns 401 for a secret that only differs at the end (would pass a broken comparison)", async () => {
    process.env.CRON_SECRET = SECRET;

    const res = await post({
      Authorization: `Bearer ${SECRET.slice(0, -1)}x`,
    });

    expect(res.status).toBe(401);
    expect(candidates).not.toHaveBeenCalled();
  });

  it("returns 200 and calls the run exactly once for the correct secret", async () => {
    process.env.CRON_SECRET = SECRET;

    const res = await post({ Authorization: `Bearer ${SECRET}` });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(candidates).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({ examined: 0, changed: 0, changeRows: 0, failures: 0 });
  });

  it("returns 503 and never calls the port when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;

    const res = await post({ Authorization: "Bearer anything" });

    expect(res.status).toBe(503);
    expect(candidates).not.toHaveBeenCalled();
  });

  it("returns 503 and never calls the port when CRON_SECRET is unset, even with the run-time value as the header", async () => {
    delete process.env.CRON_SECRET;

    // Guards against a bug where an unset secret falls through to comparing
    // against undefined/empty string and accidentally matching.
    const res = await post({ Authorization: "Bearer " });

    expect(res.status).toBe(503);
    expect(candidates).not.toHaveBeenCalled();
  });

  it("never includes the secret in the response body", async () => {
    process.env.CRON_SECRET = SECRET;

    const res = await post({ Authorization: `Bearer ${SECRET}` });
    const text = await res.text();

    expect(text).not.toContain(SECRET);
  });

  it("never includes the secret in the 401 body", async () => {
    process.env.CRON_SECRET = SECRET;

    const res = await post({ Authorization: `Bearer ${SECRET.slice(0, -1)}x` });
    const text = await res.text();

    expect(res.status).toBe(401);
    // A rejection body must not confirm any part of the secret, and must not
    // echo the supplied credential back either.
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(SECRET.slice(0, -1));
  });

  it("never includes the secret in the 503 body", async () => {
    process.env.CRON_SECRET = SECRET;
    const supplied = `Bearer ${SECRET}`;
    delete process.env.CRON_SECRET;

    const res = await post({ Authorization: supplied });
    const text = await res.text();

    expect(res.status).toBe(503);
    expect(text).not.toContain(SECRET);
  });

  it("returns 401 for a non-Bearer scheme carrying the raw secret", async () => {
    process.env.CRON_SECRET = SECRET;

    const res = await post({ Authorization: SECRET });

    expect(res.status).toBe(401);
    expect(candidates).not.toHaveBeenCalled();
    expect(await res.text()).not.toContain(SECRET);
  });

  it("returns 401 for a Basic scheme carrying the secret", async () => {
    process.env.CRON_SECRET = SECRET;

    const res = await post({ Authorization: `Basic ${SECRET}` });

    expect(res.status).toBe(401);
    expect(candidates).not.toHaveBeenCalled();
  });

  it("rejects GET with 405", async () => {
    const res = await get();
    expect(res.status).toBe(405);
  });

  it("calls the drain after the refresh completes", async () => {
    process.env.CRON_SECRET = SECRET;

    const res = await post({ Authorization: `Bearer ${SECRET}` });

    expect(res.status).toBe(200);
    expect(drainQueue).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["refresh:candidates", "drain:drainQueue"]);
  });

  it("does not turn a successful refresh into a 500 when the drain fails", async () => {
    process.env.CRON_SECRET = SECRET;
    drainQueue.mockImplementation(async () => {
      throw new Error("push service unreachable");
    });

    const res = await post({ Authorization: `Bearer ${SECRET}` });
    const body = await res.json();

    expect(res.status).toBe(200);
    // Recording changes already succeeded by the time the drain runs, so its
    // failure is surfaced in the body's counts rather than as a 500.
    expect(body).toMatchObject({
      examined: 0,
      changed: 0,
      changeRows: 0,
      failures: 0,
      notificationsClaimed: 0,
      notificationsSent: 0,
      notificationsFailed: 0,
    });
  });
});
