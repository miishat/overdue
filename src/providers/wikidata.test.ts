import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../tests/msw-server";
import fixture from "../../tests/fixtures/wikidata-series-entries.json";
import { precisionFromWikidata, wikidataProvider } from "./wikidata";

const ENDPOINT = "https://query.wikidata.org/sparql";

describe("precisionFromWikidata", () => {
  it("maps 11 to day, 10 to month, 9 to year", () => {
    expect(precisionFromWikidata("11")).toBe("day");
    expect(precisionFromWikidata("10")).toBe("month");
    expect(precisionFromWikidata("9")).toBe("year");
  });

  it("defaults to day when the precision is unknown", () => {
    expect(precisionFromWikidata(undefined)).toBe("day");
  });
});

describe("wikidataProvider", () => {
  it("maps bindings to ProviderBook with ordinals", async () => {
    server.use(http.get(ENDPOINT, () => HttpResponse.json(fixture)));
    const entries = await wikidataProvider.getSeriesEntries("Q45875");

    expect(entries[0]).toMatchObject({
      provider: "wikidata",
      externalId: "Q1234",
      title: "A Dance with Dragons",
      seriesPosition: 5,
      releaseDate: "2011-07-12",
      datePrecision: "day",
    });
  });

  it("yields an entry with no date for an announced book", async () => {
    server.use(http.get(ENDPOINT, () => HttpResponse.json(fixture)));
    const entries = await wikidataProvider.getSeriesEntries("Q45875");

    expect(entries[1]).toMatchObject({
      externalId: "Q5678",
      title: "The Winds of Winter",
      seriesPosition: 6,
    });
    expect(entries[1].releaseDate).toBeUndefined();
    expect(entries[1].datePrecision).toBeUndefined();
  });

  it("returns an empty array when the endpoint errors", async () => {
    server.use(http.get(ENDPOINT, () => new HttpResponse(null, { status: 429 })));
    await expect(wikidataProvider.getSeriesEntries("Q1")).resolves.toEqual([]);
  });

  it("returns an empty array when bindings is not an array", async () => {
    server.use(
      http.get(ENDPOINT, () =>
        HttpResponse.json({ results: { bindings: { not: "an array" } } }),
      ),
    );
    await expect(wikidataProvider.getSeriesEntries("Q1")).resolves.toEqual([]);
  });
});
