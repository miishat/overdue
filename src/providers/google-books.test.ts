import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
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
});
