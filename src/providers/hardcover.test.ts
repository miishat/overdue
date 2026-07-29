import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../../tests/msw-server";
import searchFixture from "../../tests/fixtures/hardcover-search.json";
import entriesFixture from "../../tests/fixtures/hardcover-series-entries.json";
import { hardcoverProvider } from "./hardcover";

const ENDPOINT = "https://api.hardcover.app/v1/graphql";

beforeEach(() => {
  process.env.HARDCOVER_API_TOKEN = "test-token";
});

describe("hardcoverProvider", () => {
  it("maps books with series membership and position", async () => {
    server.use(http.post(ENDPOINT, () => HttpResponse.json(searchFixture)));
    const results = await hardcoverProvider.searchBooks("way of kings");

    expect(results[0]).toMatchObject({
      provider: "hardcover",
      externalId: "12345",
      title: "The Way of Kings",
      authors: ["Brandon Sanderson"],
      seriesName: "The Stormlight Archive",
      seriesExternalId: "77",
      seriesPosition: 1,
      releaseDate: "2010-08-31",
      datePrecision: "day",
    });
  });

  it("sends the bearer token", async () => {
    let seen: string | null = null;
    server.use(
      http.post(ENDPOINT, ({ request }) => {
        seen = request.headers.get("authorization");
        return HttpResponse.json(searchFixture);
      }),
    );
    await hardcoverProvider.searchBooks("x");
    expect(seen).toBe("Bearer test-token");
  });

  it("returns series entries including undated future books", async () => {
    server.use(http.post(ENDPOINT, () => HttpResponse.json(entriesFixture)));
    const entries = await hardcoverProvider.getSeriesEntries("77");

    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      externalId: "99999",
      title: "Stormlight Archive, Book Six",
      seriesPosition: 6,
    });
    expect(entries[1].releaseDate).toBeUndefined();
  });

  it("populates seriesName on every discovered series entry", async () => {
    server.use(http.post(ENDPOINT, () => HttpResponse.json(entriesFixture)));
    const entries = await hardcoverProvider.getSeriesEntries("77");

    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.seriesName).toBe("The Stormlight Archive");
    }
  });

  it("returns an empty array when GraphQL reports errors", async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json({ errors: [{ message: "depth limit exceeded" }] }),
      ),
    );
    await expect(hardcoverProvider.searchBooks("x")).resolves.toEqual([]);
  });

  it("returns an empty array when the token is missing", async () => {
    delete process.env.HARDCOVER_API_TOKEN;
    await expect(hardcoverProvider.searchBooks("x")).resolves.toEqual([]);
  });

  it("returns an empty array when search.results.hits is not an array", async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json({
          data: { search: { results: { hits: { unexpected: "object" } } } },
        }),
      ),
    );
    await expect(hardcoverProvider.searchBooks("x")).resolves.toEqual([]);
  });
});
