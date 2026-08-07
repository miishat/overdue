import { describe, expect, it, vi } from "vitest";
import type { ProviderBook } from "@/providers/types";

const searchAllProviders = vi.fn<
  (query: string, signal?: AbortSignal) => Promise<ProviderBook[]>
>();
vi.mock("@/providers/registry", () => ({ searchAllProviders }));

async function callRoute(url: string) {
  const { GET } = await import("./route");
  return GET(new Request(url));
}

function book(overrides: Partial<ProviderBook>): ProviderBook {
  return {
    provider: "google",
    externalId: "id",
    title: "Untitled",
    authors: ["Author"],
    ...overrides,
  };
}

describe("GET /api/search", () => {
  it("returns 400 when q is missing", async () => {
    const res = await callRoute("http://localhost/api/search");
    expect(res.status).toBe(400);
  });

  it("returns 400 when q is shorter than two characters", async () => {
    const res = await callRoute("http://localhost/api/search?q=a");
    expect(res.status).toBe(400);
  });

  it("returns 400 when q is whitespace only", async () => {
    const res = await callRoute("http://localhost/api/search?q=%20%20");
    expect(res.status).toBe(400);
  });

  it("merges provider records into resolved results", async () => {
    searchAllProviders.mockResolvedValueOnce([
      {
        provider: "google",
        externalId: "g",
        title: "Babel",
        authors: ["R. F. Kuang"],
        isbn13: "9780008501815",
        description: "From Google.",
      },
      {
        provider: "hardcover",
        externalId: "h",
        title: "Babel",
        authors: ["R. F. Kuang"],
        isbn13: "9780008501815",
        seriesName: "Standalone Series",
        seriesPosition: 1,
      },
    ]);

    const res = await callRoute("http://localhost/api/search?q=babel");
    const body = (await res.json()) as { results: { seriesName?: string }[] };

    expect(res.status).toBe(200);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].seriesName).toBe("Standalone Series");
  });

  it("sorts results by confidence descending", async () => {
    searchAllProviders.mockResolvedValueOnce([
      book({
        externalId: "low",
        title: "Low Confidence",
        authors: ["Author One"],
        isbn13: "1111111111111",
      }),
      book({
        externalId: "high",
        title: "High Confidence",
        authors: ["Author Two"],
        isbn13: "2222222222222",
        provider: "hardcover",
        releaseDate: "2024-01-01",
      }),
      book({
        externalId: "mid",
        title: "Mid Confidence",
        authors: ["Author Three"],
        isbn13: "3333333333333",
        releaseDate: "2024-06-01",
      }),
    ]);

    const res = await callRoute("http://localhost/api/search?q=confidence");
    const body = (await res.json()) as {
      results: { title: string; confidence: number }[];
    };

    expect(res.status).toBe(200);
    expect(body.results).toHaveLength(3);
    const confidences = body.results.map((r) => r.confidence);
    expect(confidences).toEqual([...confidences].sort((a, b) => b - a));
  });

  it("caps results at 20", async () => {
    const books: ProviderBook[] = Array.from({ length: 25 }, (_, i) =>
      book({
        externalId: `id-${i}`,
        title: `Book ${i}`,
        authors: [`Author ${i}`],
        isbn13: `${(1000000000000 + i).toString().padStart(13, "0")}`,
      }),
    );
    searchAllProviders.mockResolvedValueOnce(books);

    const res = await callRoute("http://localhost/api/search?q=book");
    const body = (await res.json()) as { results: unknown[] };

    expect(res.status).toBe(200);
    expect(body.results).toHaveLength(20);
  });

  it("passes the request signal to searchAllProviders", async () => {
    const { GET } = await import("./route");
    searchAllProviders.mockResolvedValueOnce([]);

    const request = new Request("http://localhost/api/search?q=babel");
    await GET(request);

    expect(searchAllProviders).toHaveBeenCalledWith(
      "babel",
      request.signal,
    );
  });
});
