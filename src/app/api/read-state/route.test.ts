import { describe, expect, it, vi } from "vitest";

// db/client.ts throws if DATABASE_URL is unset. neon() only builds a lazy
// query function at construction time and does not connect, so a placeholder
// here lets vi.importActual load read-state.ts's real isReadStateValue
// without ever touching a real database.
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";

const set = vi.fn(async () => undefined);

vi.mock("@/lib/read-state", async () => {
  const actual = await vi.importActual<typeof import("@/lib/read-state")>(
    "@/lib/read-state",
  );
  return {
    ...actual,
    drizzleReadStateStore: { get: vi.fn(), set },
  };
});
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn(async () => "u1"),
  LOCAL_USER_ID: "u1",
}));

async function post(body: unknown) {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost/api/read-state", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("POST /api/read-state", () => {
  it("accepts a valid state and calls the store once with the resolved user id", async () => {
    set.mockClear();
    const res = await post({ bookId: "book-1", state: "reading" });

    expect(res.status).toBe(200);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith("u1", "book-1", "reading");
  });

  it("rejects an unknown state and never calls the store", async () => {
    set.mockClear();
    const res = await post({ bookId: "book-1", state: "finished" });

    expect(res.status).toBe(400);
    expect(set).not.toHaveBeenCalled();
  });

  it("rejects a missing bookId", async () => {
    set.mockClear();
    const res = await post({ state: "reading" });

    expect(res.status).toBe(400);
    expect(set).not.toHaveBeenCalled();
  });

  it("rejects a malformed JSON body without throwing", async () => {
    set.mockClear();
    const res = await post("{not json");

    expect(res.status).toBe(400);
    expect(set).not.toHaveBeenCalled();
  });
});
