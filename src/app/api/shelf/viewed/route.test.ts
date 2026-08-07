import { describe, expect, it, vi } from "vitest";
import type { SeenStore } from "@/lib/seen";

// db/client.ts throws if DATABASE_URL is unset. neon() only builds a lazy
// query function at construction time and does not connect, so a placeholder
// here lets vi.importActual load seen.ts's real changedBookIds without ever
// touching a real database.
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";

const markViewed = vi.fn<SeenStore["markViewed"]>(async () => undefined);
const lastViewedAt = vi.fn<SeenStore["lastViewedAt"]>(async () => null);

vi.mock("@/lib/seen", async () => {
  const actual = await vi.importActual<typeof import("@/lib/seen")>(
    "@/lib/seen",
  );
  return {
    ...actual,
    drizzleSeenStore: { lastViewedAt, markViewed, changesSince: vi.fn() },
  };
});
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn(async () => "u1"),
  LOCAL_USER_ID: "u1",
}));

async function post(body: unknown) {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost/api/shelf/viewed", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("POST /api/shelf/viewed", () => {
  it("passes the exact posted viewedAt through to markViewed", async () => {
    markViewed.mockClear();
    lastViewedAt.mockResolvedValueOnce(null);
    const viewedAt = "2026-07-29T00:00:00.000Z";

    const res = await post({ viewedAt });

    expect(res.status).toBe(200);
    expect(markViewed).toHaveBeenCalledTimes(1);
    const [, at] = markViewed.mock.calls[0];
    expect(at.toISOString()).toBe(viewedAt);
  });

  it("uses getCurrentUserId for the user id, never the request body", async () => {
    markViewed.mockClear();
    lastViewedAt.mockResolvedValueOnce(null);

    await post({ viewedAt: "2026-07-29T00:00:00.000Z", userId: "attacker" });

    expect(markViewed).toHaveBeenCalledTimes(1);
    const [userId] = markViewed.mock.calls[0];
    expect(userId).toBe("u1");
  });

  it("rejects a missing viewedAt without calling the store", async () => {
    markViewed.mockClear();
    const res = await post({});

    expect(res.status).toBe(400);
    expect(markViewed).not.toHaveBeenCalled();
  });

  it("rejects a non-string viewedAt without calling the store", async () => {
    markViewed.mockClear();
    const res = await post({ viewedAt: 12345 });

    expect(res.status).toBe(400);
    expect(markViewed).not.toHaveBeenCalled();
  });

  it("rejects an unparseable date string without calling the store", async () => {
    markViewed.mockClear();
    const res = await post({ viewedAt: "not-a-date" });

    expect(res.status).toBe(400);
    expect(markViewed).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with an error response rather than throwing", async () => {
    markViewed.mockClear();
    const res = await post("{not json");

    expect(res.status).toBe(400);
    expect(markViewed).not.toHaveBeenCalled();
  });

  it("clamps a future viewedAt down to the server's current time", async () => {
    markViewed.mockClear();
    lastViewedAt.mockResolvedValueOnce(null);
    const farFuture = "9999-01-01T00:00:00.000Z";

    const before = Date.now();
    const res = await post({ viewedAt: farFuture });
    const after = Date.now();

    expect(res.status).toBe(200);
    expect(markViewed).toHaveBeenCalledTimes(1);
    const [, at] = markViewed.mock.calls[0];
    expect(at.getTime()).toBeGreaterThanOrEqual(before);
    expect(at.getTime()).toBeLessThanOrEqual(after);
  });

  it("clamps a viewedAt earlier than the stored baseline up to the baseline", async () => {
    markViewed.mockClear();
    const baseline = new Date("2026-07-29T00:00:00.000Z");
    lastViewedAt.mockResolvedValueOnce(baseline);

    const res = await post({ viewedAt: "2020-01-01T00:00:00.000Z" });

    expect(res.status).toBe(200);
    expect(markViewed).toHaveBeenCalledTimes(1);
    const [, at] = markViewed.mock.calls[0];
    expect(at.toISOString()).toBe(baseline.toISOString());
  });
});
