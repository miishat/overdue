import { describe, expect, it, vi } from "vitest";

const persistResolvedBook = vi.fn(async () => ({
  bookId: "book-1",
  seriesId: "series-1",
}));
const insertTrack = vi.fn(async () => undefined);

// tracks.ts imports db/client, which throws without DATABASE_URL, so
// importOriginal is not usable here the way it is for a pure module. Only
// insertTrack needs mocking: isValidClientReleaseDate now lives in
// src/lib/catalog-input.ts, a pure module this route imports directly and
// unmocked, so this test exercises the real predicate rather than a
// hand-copied reimplementation that could drift from it.
vi.mock("@/lib/persist", () => ({ persistResolvedBook }));
vi.mock("@/lib/tracks", () => ({ insertTrack }));
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn(async () => "u1"),
  LOCAL_USER_ID: "u1",
}));
vi.mock("@/lib/discover", () => ({
  discoverSeriesEntries: vi.fn(async () => []),
}));

// The route schedules series discovery with `after` so it runs once the
// response is sent. These tests call POST directly rather than through the
// Next runtime, where `after` would have no request context, so it is
// captured here instead. Nothing runs the callbacks automatically: a test
// that wants the discovery work to happen has to call runScheduledWork,
// which is what lets "the response comes back before discovery" be asserted
// rather than assumed.
const scheduledWork: Array<() => Promise<void> | void> = [];
vi.mock("next/server", () => ({
  after: (callback: () => Promise<void> | void) => {
    scheduledWork.push(callback);
  },
}));

async function runScheduledWork(): Promise<void> {
  const pending = scheduledWork.splice(0);
  for (const callback of pending) {
    await callback();
  }
}

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

async function postRaw(rawBody: string) {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost/api/track", {
      method: "POST",
      body: rawBody,
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

  it("does not run discovery when scope is book", async () => {
    const { discoverSeriesEntries } = await import("@/lib/discover");
    vi.mocked(discoverSeriesEntries).mockClear();

    const res = await post({ book, scope: "book" });

    expect(res.status).toBe(201);
    expect(discoverSeriesEntries).not.toHaveBeenCalled();
  });

  it("still succeeds if discovery fails", async () => {
    const { discoverSeriesEntries } = await import("@/lib/discover");
    vi.mocked(discoverSeriesEntries).mockRejectedValueOnce(
      new Error("provider outage"),
    );

    const res = await post({
      book: { ...book, sources: [{ provider: "hardcover", externalId: "77" }] },
      scope: "series",
    });
    await runScheduledWork();

    expect(res.status).toBe(201);
    expect(insertTrack).toHaveBeenCalledWith("u1", {
      seriesId: "series-1",
      bookId: null,
    });
  });
});

describe("POST /api/track releaseDate validation", () => {
  it("rejects a client-supplied null releaseDate instead of clearing a stored date", async () => {
    persistResolvedBook.mockClear();
    const res = await post({ book: { ...book, releaseDate: null }, scope: "book" });

    expect(res.status).toBe(400);
    expect(persistResolvedBook).not.toHaveBeenCalled();
  });

  it("rejects a non-string, non-null releaseDate", async () => {
    persistResolvedBook.mockClear();
    const res = await post({ book: { ...book, releaseDate: 12345 }, scope: "book" });

    expect(res.status).toBe(400);
    expect(persistResolvedBook).not.toHaveBeenCalled();
  });

  it("accepts an omitted releaseDate", async () => {
    const res = await post({ book, scope: "book" });
    expect(res.status).toBe(201);
  });

  it("accepts a genuine releaseDate string", async () => {
    const res = await post({
      book: { ...book, releaseDate: "2027-01-15" },
      scope: "book",
    });
    expect(res.status).toBe(201);
  });
});

describe("POST /api/track malformed body (E1)", () => {
  it("returns 400, not 500, for a body that is not valid JSON", async () => {
    const res = await postRaw("{not json");
    expect(res.status).toBe(400);
  });
});

describe("POST /api/track book validation (E1)", () => {
  it("rejects an unknown provider in sources rather than hitting the database", async () => {
    persistResolvedBook.mockClear();
    const res = await post({
      book: { ...book, sources: [{ provider: "bookshop", externalId: "1" }] },
      scope: "book",
    });

    expect(res.status).toBe(400);
    expect(persistResolvedBook).not.toHaveBeenCalled();
  });

  it("rejects a coverUrl this app is not willing to render", async () => {
    persistResolvedBook.mockClear();
    const res = await post({
      book: { ...book, coverUrl: "http://example.com/cover.jpg" },
      scope: "book",
    });

    expect(res.status).toBe(400);
    expect(persistResolvedBook).not.toHaveBeenCalled();
  });

  it("accepts a safe https coverUrl", async () => {
    const res = await post({
      book: { ...book, coverUrl: "https://covers.example.com/cover.jpg" },
      scope: "book",
    });

    expect(res.status).toBe(201);
  });

  it("rejects a title over the length bound", async () => {
    persistResolvedBook.mockClear();
    const res = await post({
      book: { ...book, title: "x".repeat(1000) },
      scope: "book",
    });

    expect(res.status).toBe(400);
    expect(persistResolvedBook).not.toHaveBeenCalled();
  });

  it("does not echo the offending value back in the error body", async () => {
    const secretLookingValue = "sk-super-secret-value-should-not-appear";
    const res = await post({
      book: { ...book, title: secretLookingValue.repeat(50) },
      scope: "book",
    });

    expect(res.status).toBe(400);
    const responseText = await res.text();
    expect(responseText).not.toContain(secretLookingValue);
  });
});

describe("POST /api/track with series scope", () => {
  it("discovers and persists the other entries in the series", async () => {
    const { discoverSeriesEntries } = await import("@/lib/discover");
    vi.mocked(discoverSeriesEntries).mockResolvedValueOnce([
      {
        key: "k1",
        title: "Book One",
        authors: ["A"],
        seriesPosition: 1,
        provenance: {},
        sources: [],
        confidence: 70,
      },
      {
        key: "k2",
        title: "Book Two",
        authors: ["A"],
        seriesPosition: 2,
        provenance: {},
        sources: [],
        confidence: 70,
      },
    ]);

    persistResolvedBook.mockClear();
    await post({
      book: { ...book, sources: [{ provider: "hardcover", externalId: "77" }] },
      scope: "series",
    });

    // The response is already out at this point, and only the selected book
    // has been written. This is the assertion that would fail if discovery
    // were moved back onto the request path.
    expect(persistResolvedBook).toHaveBeenCalledTimes(1);

    await runScheduledWork();

    // Once for the selected book, then once per discovered entry.
    expect(persistResolvedBook).toHaveBeenCalledTimes(3);
  });

  it("returns before discovery has made a single provider call", async () => {
    const { discoverSeriesEntries } = await import("@/lib/discover");
    vi.mocked(discoverSeriesEntries).mockClear();

    const res = await post({
      book: { ...book, sources: [{ provider: "hardcover", externalId: "77" }] },
      scope: "series",
    });

    expect(res.status).toBe(201);
    expect(discoverSeriesEntries).not.toHaveBeenCalled();

    await runScheduledWork();
    expect(discoverSeriesEntries).toHaveBeenCalledTimes(1);
  });
});
