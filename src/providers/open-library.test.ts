import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../tests/msw-server";
import fixture from "../../tests/fixtures/open-library-search.json";
import { openLibraryProvider } from "./open-library";

const ENDPOINT = "https://openlibrary.org/search.json";

describe("openLibraryProvider", () => {
  it("maps docs to ProviderBook with a cover URL", async () => {
    server.use(http.get(ENDPOINT, () => HttpResponse.json(fixture)));
    const results = await openLibraryProvider.searchBooks("way of kings");

    expect(results[0]).toMatchObject({
      provider: "openlibrary",
      externalId: "OL123W",
      title: "The Way of Kings",
      isbn13: "9780765326355",
      coverUrl: "https://covers.openlibrary.org/b/id/8231856-L.jpg",
      releaseDate: "2010-01-01",
      datePrecision: "year",
    });
  });

  it("omits the cover when cover_i is absent", async () => {
    server.use(http.get(ENDPOINT, () => HttpResponse.json(fixture)));
    const results = await openLibraryProvider.searchBooks("no cover");
    expect(results[1].coverUrl).toBeUndefined();
  });

  it("never reports series membership", async () => {
    server.use(http.get(ENDPOINT, () => HttpResponse.json(fixture)));
    const results = await openLibraryProvider.searchBooks("way of kings");
    expect(results[0].seriesName).toBeUndefined();
    expect(results[0].seriesPosition).toBeUndefined();
  });

  it("returns an empty array when the API errors", async () => {
    server.use(http.get(ENDPOINT, () => new HttpResponse(null, { status: 503 })));
    await expect(openLibraryProvider.searchBooks("x")).resolves.toEqual([]);
  });

  it("returns an empty array when docs is not an array", async () => {
    server.use(http.get(ENDPOINT, () => HttpResponse.json({ docs: { not: "an array" } })));
    await expect(openLibraryProvider.searchBooks("x")).resolves.toEqual([]);
  });
});
