import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { server } from "../../tests/msw-server";
import fixture from "../../tests/fixtures/google-books-search.json";
import { googleBooksProvider } from "./google-books";

const ENDPOINT = "https://www.googleapis.com/books/v1/volumes";

describe("googleBooksProvider", () => {
  it("maps volumes to ProviderBook", async () => {
    server.use(http.get(ENDPOINT, () => HttpResponse.json(fixture)));
    const results = await googleBooksProvider.searchBooks("way of kings");

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      provider: "google",
      externalId: "gbs-1",
      title: "The Way of Kings",
      authors: ["Brandon Sanderson"],
      isbn13: "9780765326355",
      releaseDate: "2010-08-31",
      datePrecision: "day",
    });
  });

  it("infers year precision from a year-only publishedDate", async () => {
    server.use(http.get(ENDPOINT, () => HttpResponse.json(fixture)));
    const results = await googleBooksProvider.searchBooks("sequel");
    expect(results[1].releaseDate).toBe("2027-01-01");
    expect(results[1].datePrecision).toBe("year");
  });

  it("upgrades cover URLs to https", async () => {
    server.use(http.get(ENDPOINT, () => HttpResponse.json(fixture)));
    const results = await googleBooksProvider.searchBooks("way of kings");
    expect(results[0].coverUrl).toBe("https://books.google.com/cover1");
  });

  it("returns an empty array when the API errors", async () => {
    server.use(http.get(ENDPOINT, () => new HttpResponse(null, { status: 500 })));
    await expect(googleBooksProvider.searchBooks("anything")).resolves.toEqual([]);
  });

  it("never reports series data", async () => {
    await expect(googleBooksProvider.getSeries("anything")).resolves.toBeNull();
    await expect(googleBooksProvider.getSeriesEntries("anything")).resolves.toEqual([]);
  });

  it("returns an empty array when items is not an array", async () => {
    server.use(http.get(ENDPOINT, () => HttpResponse.json({ items: { not: "an array" } })));
    await expect(googleBooksProvider.searchBooks("anything")).resolves.toEqual([]);
  });

  it("drops a volume missing volumeInfo without throwing", async () => {
    server.use(
      http.get(ENDPOINT, () =>
        HttpResponse.json({ items: [{ id: "no-info" }, ...fixture.items] }),
      ),
    );
    await expect(googleBooksProvider.searchBooks("anything")).resolves.toHaveLength(2);
  });

  describe("API key", () => {
    const ORIGINAL = process.env.GOOGLE_BOOKS_API_KEY;

    beforeEach(() => {
      delete process.env.GOOGLE_BOOKS_API_KEY;
    });

    afterEach(() => {
      if (ORIGINAL === undefined) delete process.env.GOOGLE_BOOKS_API_KEY;
      else process.env.GOOGLE_BOOKS_API_KEY = ORIGINAL;
    });

    it("omits the key parameter when none is configured", async () => {
      let seenUrl = "";
      server.use(
        http.get(ENDPOINT, ({ request }) => {
          seenUrl = request.url;
          return HttpResponse.json(fixture);
        }),
      );
      await googleBooksProvider.searchBooks("way of kings");
      expect(seenUrl).not.toContain("key=");
    });

    it("appends the key parameter when GOOGLE_BOOKS_API_KEY is set", async () => {
      process.env.GOOGLE_BOOKS_API_KEY = "test-key-123";
      let seenUrl = "";
      server.use(
        http.get(ENDPOINT, ({ request }) => {
          seenUrl = request.url;
          return HttpResponse.json(fixture);
        }),
      );
      await googleBooksProvider.searchBooks("way of kings");
      expect(seenUrl).toContain("key=test-key-123");
    });

    it("appends the key correctly to getBook, which has no prior query string", async () => {
      process.env.GOOGLE_BOOKS_API_KEY = "test-key-456";
      let seenUrl = "";
      server.use(
        http.get(`${ENDPOINT}/gbs-1`, ({ request }) => {
          seenUrl = request.url;
          return HttpResponse.json(fixture.items[0]);
        }),
      );
      await googleBooksProvider.getBook("gbs-1");
      expect(seenUrl).toContain("?key=test-key-456");
    });
  });
});
