import { describe, expect, it, vi } from "vitest";

const persistResolvedBook = vi.fn(async () => ({
  bookId: "book-1",
  seriesId: null,
}));
const insertTrack = vi.fn(async () => undefined);

vi.mock("@/lib/persist", () => ({ persistResolvedBook }));
vi.mock("@/lib/tracks", () => ({ insertTrack }));
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn(async () => "u1"),
  LOCAL_USER_ID: "u1",
}));

async function post(body: unknown) {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost/api/manual", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/manual", () => {
  it("rejects a missing title", async () => {
    const res = await post({ author: "Someone" });
    expect(res.status).toBe(400);
  });

  it("rejects a whitespace-only title", async () => {
    const res = await post({ title: "   " });
    expect(res.status).toBe(400);
  });

  it("creates a manual book and tracks it", async () => {
    persistResolvedBook.mockClear();
    insertTrack.mockClear();
    const res = await post({
      title: "An Unlisted Book",
      author: "Obscure Author",
      sourceUrl: "https://example.com/blog-post",
    });

    expect(res.status).toBe(201);
    const passed = persistResolvedBook.mock.calls[0][0] as unknown as {
      sources: { provider: string; sourceUrl?: string }[];
      confidence: number;
    };
    expect(passed.sources[0].provider).toBe("manual");
    expect(passed.confidence).toBe(100);
    expect(insertTrack).toHaveBeenCalledWith("u1", {
      seriesId: null,
      bookId: "book-1",
    });
  });

  it("carries sourceUrl onto the manual source record", async () => {
    persistResolvedBook.mockClear();
    await post({
      title: "Provenance Matters",
      sourceUrl: "https://example.com/author-blog-june-2026",
    });

    const passed = persistResolvedBook.mock.calls[0][0] as unknown as {
      sources: { provider: string; sourceUrl?: string }[];
    };
    expect(passed.sources[0].sourceUrl).toBe(
      "https://example.com/author-blog-june-2026",
    );
  });

  it("tracks the manual entry as a book, not a series", async () => {
    insertTrack.mockClear();
    await post({ title: "Book Not Series" });

    expect(insertTrack).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ seriesId: null }),
    );
  });
});
