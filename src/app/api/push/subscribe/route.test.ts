import { describe, expect, it, vi } from "vitest";

// db/client.ts throws if DATABASE_URL is unset. neon() only builds a lazy
// query function at construction time and does not connect, so a placeholder
// here lets vi.importActual load subscriptions.ts's real isSubscriptionInput
// without ever touching a real database.
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";

// A fake store standing in for the whole SubscriptionStore interface, not a
// bare mocked function, so wiring mistakes (e.g. wrong method called) show
// up as a failing test rather than being invisible.
const upsert = vi.fn(async () => undefined);
const fakeStore = {
  upsert,
  remove: vi.fn(async () => undefined),
  listFor: vi.fn(async () => []),
  recordSuccess: vi.fn(async () => undefined),
  recordFailure: vi.fn(async () => undefined),
};

vi.mock("@/lib/push/subscriptions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/push/subscriptions")>(
    "@/lib/push/subscriptions",
  );
  return {
    ...actual,
    drizzleSubscriptionStore: fakeStore,
  };
});
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn(async () => "u1"),
  LOCAL_USER_ID: "u1",
}));

async function post(body: unknown) {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost/api/push/subscribe", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const validSubscription = {
  endpoint: "https://push.example.com/abc",
  p256dh: "secret-p256dh",
  auth: "secret-auth",
  userAgent: "Mozilla/5.0",
};

describe("POST /api/push/subscribe", () => {
  it("accepts a valid body and calls upsert once with the resolved user id", async () => {
    upsert.mockClear();
    const res = await post(validSubscription);

    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith("u1", validSubscription);
  });

  it("rejects a malformed body and never calls the store", async () => {
    upsert.mockClear();
    const res = await post({ endpoint: "https://push.example.com/abc" });

    expect(res.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON without throwing", async () => {
    upsert.mockClear();
    const res = await post("{not json");

    expect(res.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("never includes subscription keys in the response body", async () => {
    const res = await post(validSubscription);
    const json = (await res.json()) as Record<string, unknown>;

    const text = JSON.stringify(json);
    expect(text).not.toContain(validSubscription.p256dh);
    expect(text).not.toContain(validSubscription.auth);
    expect(json).not.toHaveProperty("p256dh");
    expect(json).not.toHaveProperty("auth");
  });
});
