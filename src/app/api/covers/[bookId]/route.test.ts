import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// db/client.ts throws if DATABASE_URL is unset. neon() only builds a lazy
// query function and does not connect, so a placeholder is enough here.
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";

const rows = vi.fn<() => Promise<Array<{ coverUrl: string | null }>>>();

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => rows(),
      }),
    }),
  },
}));

const BOOK_ID = "11111111-2222-3333-4444-555555555555";

async function get(bookId = BOOK_ID) {
  const { GET } = await import("./route");
  return GET(new Request(`http://localhost/api/covers/${bookId}`), {
    params: Promise.resolve({ bookId }),
  });
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  rows.mockReset();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("GET /api/covers/[bookId]", () => {
  it("rejects an id that is not a uuid without touching the database", async () => {
    const res = await get("not-a-uuid");

    expect(res.status).toBe(400);
    expect(rows).not.toHaveBeenCalled();
  });

  it("returns 404 when there is no such book", async () => {
    rows.mockResolvedValue([]);

    const res = await get();

    expect(res.status).toBe(404);
  });

  it("returns 404 when the book has no cover", async () => {
    rows.mockResolvedValue([{ coverUrl: null }]);

    const res = await get();

    expect(res.status).toBe(404);
  });

  it("refuses a stored cover url that isSafeCoverUrl rejects, without fetching it", async () => {
    rows.mockResolvedValue([{ coverUrl: "http://169.254.169.254/latest/meta-data/" }]);
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const res = await get();

    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("streams the upstream image back with a cacheable content type", async () => {
    rows.mockResolvedValue([{ coverUrl: "https://covers.openlibrary.org/b/id/1-L.jpg" }]);
    globalThis.fetch = vi.fn(async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    ) as unknown as typeof fetch;

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toContain("max-age=86400");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("never echoes the provider url back to the client", async () => {
    const upstream = "https://covers.openlibrary.org/b/id/1-L.jpg";
    rows.mockResolvedValue([{ coverUrl: upstream }]);
    globalThis.fetch = vi.fn(async () =>
      new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "content-type": "image/jpeg", "x-served-by": upstream },
      }),
    ) as unknown as typeof fetch;

    const res = await get();

    const headerBlob = [...res.headers.entries()].map(([k, v]) => `${k}:${v}`).join("\n");
    expect(headerBlob).not.toContain("openlibrary");
  });

  it("refuses an upstream response that is not an image", async () => {
    rows.mockResolvedValue([{ coverUrl: "https://covers.openlibrary.org/b/id/1-L.jpg" }]);
    globalThis.fetch = vi.fn(async () =>
      new Response("<html>redirected to a login page</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ) as unknown as typeof fetch;

    const res = await get();

    expect(res.status).toBe(502);
  });

  it("maps an upstream failure to 502 rather than leaking its status", async () => {
    rows.mockResolvedValue([{ coverUrl: "https://covers.openlibrary.org/b/id/1-L.jpg" }]);
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 403 })) as unknown as typeof fetch;

    const res = await get();

    expect(res.status).toBe(502);
  });

  it("maps a network error to 502 rather than throwing", async () => {
    rows.mockResolvedValue([{ coverUrl: "https://covers.openlibrary.org/b/id/1-L.jpg" }]);
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;

    const res = await get();

    expect(res.status).toBe(502);
  });

  it("never follows an upstream redirect, which would walk past isSafeCoverUrl", async () => {
    rows.mockResolvedValue([{ coverUrl: "https://covers.openlibrary.org/b/id/1-L.jpg" }]);
    // Typed with fetch's own parameter list rather than cast to typeof fetch,
    // so mock.calls[0][1] is a RequestInit the assertions below can read.
    // Casting the spy hides .mock from the compiler.
    const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const res = await get();

    expect(res.status).toBe(200);
    const fetchOptions = fetchSpy.mock.calls[0][1];
    expect(fetchOptions?.redirect).toBe("error");
    expect(fetchOptions?.signal).toBeInstanceOf(AbortSignal);
  });
});
