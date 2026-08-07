import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../../tests/msw-server";
import searchFixture from "../../tests/fixtures/hardcover-search.json";
import entriesFixture from "../../tests/fixtures/hardcover-series-entries.json";
import { hardcoverProvider, precisionForHardcoverDate } from "./hardcover";

const ENDPOINT = "https://api.hardcover.app/v1/graphql";

beforeEach(() => {
  process.env.HARDCOVER_API_TOKEN = "test-token";
});

describe("precisionForHardcoverDate", () => {
  it("returns undefined for a missing or empty date", () => {
    expect(precisionForHardcoverDate(undefined)).toBeUndefined();
    expect(precisionForHardcoverDate("")).toBeUndefined();
  });

  it("returns year for a bare January 1 date, Hardcover's year placeholder", () => {
    expect(precisionForHardcoverDate("2027-01-01")).toBe("year");
  });

  it("returns year for a January 1 date in the past too, since the rule is date-only", () => {
    expect(precisionForHardcoverDate("2010-01-01")).toBe("year");
  });

  it("returns year for anything that is not a full date, rather than claiming a day", () => {
    // release_date reaches this function through asString, which guarantees a
    // string and nothing about its shape. A bare year or a malformed value
    // must not fall through to a day claim, which is the very bug this
    // function exists to prevent.
    expect(precisionForHardcoverDate("2027")).toBe("year");
    expect(precisionForHardcoverDate("2027-06")).toBe("year");
    expect(precisionForHardcoverDate("not a date")).toBe("year");
    expect(precisionForHardcoverDate("2027-6-1")).toBe("year");
  });

  it("returns day for any other date", () => {
    expect(precisionForHardcoverDate("2010-08-31")).toBe("day");
    expect(precisionForHardcoverDate("2027-01-02")).toBe("day");
  });
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

  it("downgrades a bare January 1 release date to year precision", async () => {
    server.use(http.post(ENDPOINT, () => HttpResponse.json(searchFixture)));
    const results = await hardcoverProvider.searchBooks("way of kings");

    const placeholder = results.find((r) => r.externalId === "67890");
    expect(placeholder).toMatchObject({
      releaseDate: "2027-01-01",
      datePrecision: "year",
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

    expect(entries).toHaveLength(3);
    expect(entries[1]).toMatchObject({
      externalId: "99999",
      title: "Stormlight Archive, Book Six",
      seriesPosition: 6,
    });
    expect(entries[1].releaseDate).toBeUndefined();
  });

  it("downgrades a bare January 1 release date on series entries too", async () => {
    server.use(http.post(ENDPOINT, () => HttpResponse.json(entriesFixture)));
    const entries = await hardcoverProvider.getSeriesEntries("77");

    expect(entries[2]).toMatchObject({
      externalId: "88888",
      title: "Stormlight Archive, Book Seven",
      releaseDate: "2027-01-01",
      datePrecision: "year",
    });
  });

  it("still reports day precision for an ordinary date on this call site", async () => {
    // The year downgrade above and the pure function's own tests would both
    // still pass if toProviderBook were wired to return "year" for every
    // date. This pins the other branch at the same call site, so a hardcoded
    // precision here cannot hide behind the Jan 1 case.
    server.use(http.post(ENDPOINT, () => HttpResponse.json(entriesFixture)));
    const entries = await hardcoverProvider.getSeriesEntries("77");

    expect(entries[0]).toMatchObject({
      releaseDate: "2010-08-31",
      datePrecision: "day",
    });
  });

  it("populates seriesName on every discovered series entry", async () => {
    server.use(http.post(ENDPOINT, () => HttpResponse.json(entriesFixture)));
    const entries = await hardcoverProvider.getSeriesEntries("77");

    expect(entries).toHaveLength(3);
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

  // google-books.ts normalises an http thumbnail to https (see its
  // toProviderBook). This adapter passed image.url through unchanged, so an
  // http Hardcover cover would be silently rejected by isSafeCoverUrl (which
  // requires https) and the book would render a Gap instead of its cover.
  it("normalises an http cover URL to https on a search result, matching google-books.ts's idiom", async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json({
          data: {
            search: {
              results: {
                hits: [
                  {
                    document: {
                      id: "555",
                      title: "Insecure Cover",
                      image: { url: "http://hardcover.app/cover-insecure.jpg" },
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
    );
    const results = await hardcoverProvider.searchBooks("insecure cover");
    expect(results[0].coverUrl).toBe("https://hardcover.app/cover-insecure.jpg");
  });

  it("normalises an http cover URL to https on getBook", async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json({
          data: {
            books: [
              {
                id: 555,
                title: "Insecure Cover",
                image: { url: "http://hardcover.app/cover-insecure.jpg" },
              },
            ],
          },
        }),
      ),
    );
    const result = await hardcoverProvider.getBook("555");
    expect(result?.coverUrl).toBe("https://hardcover.app/cover-insecure.jpg");
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
