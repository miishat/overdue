import { describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";

const remove = vi.fn(async () => undefined);
const fakeStore = {
  upsert: vi.fn(async () => undefined),
  remove,
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
    new Request("http://localhost/api/push/unsubscribe", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("POST /api/push/unsubscribe", () => {
  it("removes a valid endpoint and returns 200", async () => {
    remove.mockClear();
    const res = await post({ endpoint: "https://push.example.com/abc" });

    expect(res.status).toBe(200);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("u1", "https://push.example.com/abc");
  });

  it("returns 200 even when the endpoint was never stored", async () => {
    remove.mockClear();
    remove.mockImplementationOnce(async () => undefined);
    const res = await post({ endpoint: "https://push.example.com/unknown" });

    expect(res.status).toBe(200);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed body and never calls the store", async () => {
    remove.mockClear();
    const res = await post({});

    expect(res.status).toBe(400);
    expect(remove).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON without throwing", async () => {
    remove.mockClear();
    const res = await post("{not json");

    expect(res.status).toBe(400);
    expect(remove).not.toHaveBeenCalled();
  });

  it("never includes subscription keys in the response body", async () => {
    const res = await post({ endpoint: "https://push.example.com/abc" });
    const json = (await res.json()) as Record<string, unknown>;

    expect(json).not.toHaveProperty("p256dh");
    expect(json).not.toHaveProperty("auth");
  });
});
