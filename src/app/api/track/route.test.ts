import { describe, expect, it, vi } from "vitest";

const persistResolvedBook = vi.fn(async () => ({
  bookId: "book-1",
  seriesId: "series-1",
}));
const insertTrack = vi.fn(async () => undefined);

vi.mock("@/lib/persist", () => ({ persistResolvedBook }));
vi.mock("@/lib/tracks", () => ({ insertTrack }));
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn(async () => "u1"),
  LOCAL_USER_ID: "u1",
}));

const book = {
  key: "isbn:9780008501815",
  title: "Babel",
  authors: ["R. F. Kuang"],
  seriesName: "Some Series",
  seriesPosition: 1,
  provenance: {},
  sources: [],
  confidence: 80,
};

async function post(body: unknown) {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost/api/track", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/track", () => {
  it("tracks the series when scope is series", async () => {
    const res = await post({ book, scope: "series" });
    expect(res.status).toBe(201);
    expect(insertTrack).toHaveBeenCalledWith("u1", {
      seriesId: "series-1",
      bookId: null,
    });
  });

  it("tracks the single book when scope is book", async () => {
    insertTrack.mockClear();
    const res = await post({ book, scope: "book" });
    expect(res.status).toBe(201);
    expect(insertTrack).toHaveBeenCalledWith("u1", {
      seriesId: null,
      bookId: "book-1",
    });
  });

  it("rejects an unknown scope", async () => {
    const res = await post({ book, scope: "everything" });
    expect(res.status).toBe(400);
  });
});
