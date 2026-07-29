import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../tests/msw-server";
import fixture from "../../tests/fixtures/wikidata-series-entries.json";
import searchFixture from "../../tests/fixtures/wikidata-search.json";
import enrichmentFixture from "../../tests/fixtures/wikidata-search-enrichment.json";
import {
  buildValuesClause,
  candidatesFromSearchResponse,
  precisionFromWikidata,
  wikidataProvider,
} from "./wikidata";

const ENDPOINT = "https://query.wikidata.org/sparql";
const SEARCH_ENDPOINT = "https://www.wikidata.org/w/api.php";

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

  it("populates seriesName on every discovered series entry", async () => {
    server.use(http.get(ENDPOINT, () => HttpResponse.json(fixture)));
    const entries = await wikidataProvider.getSeriesEntries("Q45875");

    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.seriesName).toBe("A Song of Ice and Fire");
    }
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

describe("buildValuesClause", () => {
  it("joins QIDs into a SPARQL VALUES list, each prefixed with wd:", () => {
    expect(buildValuesClause(["Q1", "Q2", "Q3"])).toBe("wd:Q1 wd:Q2 wd:Q3");
  });

  it("returns an empty string for an empty candidate list", () => {
    expect(buildValuesClause([])).toBe("");
  });
});

describe("candidatesFromSearchResponse", () => {
  it("maps wbsearchentities hits to qid/label candidates", () => {
    expect(candidatesFromSearchResponse(searchFixture)).toEqual([
      { qid: "Q2136877", label: "The Way of Kings" },
      { qid: "Q9999999", label: "Stormlight Archive, Book Six" },
    ]);
  });

  it("returns an empty array when the response is not a record", () => {
    expect(candidatesFromSearchResponse(null)).toEqual([]);
    expect(candidatesFromSearchResponse("nope")).toEqual([]);
  });

  it("returns an empty array when search is not an array", () => {
    expect(candidatesFromSearchResponse({ search: "nope" })).toEqual([]);
  });

  it("skips hits missing an id or label", () => {
    expect(
      candidatesFromSearchResponse({
        search: [{ id: "Q1" }, { label: "No id" }, { id: "Q2", label: "Has both" }],
      }),
    ).toEqual([{ qid: "Q2", label: "Has both" }]);
  });
});

describe("wikidataProvider.searchBooks", () => {
  it("uses wbsearchentities candidates then enriches them via a batched SPARQL query", async () => {
    server.use(
      http.get(SEARCH_ENDPOINT, () => HttpResponse.json(searchFixture)),
      http.get(ENDPOINT, () => HttpResponse.json(enrichmentFixture)),
    );

    const results = await wikidataProvider.searchBooks("the way of kings");

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      provider: "wikidata",
      externalId: "Q2136877",
      title: "The Way of Kings",
      seriesName: "The Stormlight Archive",
      seriesExternalId: "Q477675",
      seriesPosition: 1,
      releaseDate: "2010-08-31",
      datePrecision: "day",
    });
  });

  it("yields a candidate with no date for an announced book that only has an ordinal", async () => {
    server.use(
      http.get(SEARCH_ENDPOINT, () => HttpResponse.json(searchFixture)),
      http.get(ENDPOINT, () => HttpResponse.json(enrichmentFixture)),
    );

    const results = await wikidataProvider.searchBooks("the way of kings");

    const announced = results.find((r) => r.externalId === "Q9999999");
    expect(announced).toMatchObject({
      title: "Stormlight Archive, Book Six",
      seriesPosition: 6,
    });
    expect(announced?.releaseDate).toBeUndefined();
    expect(announced?.datePrecision).toBeUndefined();
  });

  it("returns an empty array when wbsearchentities errors", async () => {
    server.use(http.get(SEARCH_ENDPOINT, () => new HttpResponse(null, { status: 429 })));
    await expect(wikidataProvider.searchBooks("way of kings")).resolves.toEqual([]);
  });

  it("returns an empty array when wbsearchentities finds no candidates", async () => {
    server.use(
      http.get(SEARCH_ENDPOINT, () =>
        HttpResponse.json({ searchinfo: { search: "zzz" }, search: [], success: 1 }),
      ),
    );
    await expect(wikidataProvider.searchBooks("zzz")).resolves.toEqual([]);
  });

  it("still returns titles when the enrichment query errors", async () => {
    server.use(
      http.get(SEARCH_ENDPOINT, () => HttpResponse.json(searchFixture)),
      http.get(ENDPOINT, () => new HttpResponse(null, { status: 429 })),
    );

    const results = await wikidataProvider.searchBooks("the way of kings");

    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("The Way of Kings");
    expect(results[0].seriesName).toBeUndefined();
    expect(results[0].releaseDate).toBeUndefined();
  });

  it("still returns titles when enrichment bindings is not an array", async () => {
    server.use(
      http.get(SEARCH_ENDPOINT, () => HttpResponse.json(searchFixture)),
      http.get(ENDPOINT, () =>
        HttpResponse.json({ results: { bindings: { not: "an array" } } }),
      ),
    );

    const results = await wikidataProvider.searchBooks("the way of kings");

    expect(results).toHaveLength(2);
    expect(results[0].seriesName).toBeUndefined();
  });
});
