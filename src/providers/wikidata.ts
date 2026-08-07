import type { DatePrecision } from "@/db/schema/enums";
import { asArray, asRecord, asString, fetchJson } from "./http";
import type { MetadataProvider, ProviderBook, ProviderSeries } from "./types";

const ENDPOINT = "https://query.wikidata.org/sparql";
const SEARCH_ENDPOINT = "https://www.wikidata.org/w/api.php";
const USER_AGENT = "Overdue/1.0 (book release tracker)";

// wbsearchentities returns at most this many hits per call; it also caps how
// many candidate QIDs get batched into the single enrichment SPARQL query
// below, so that query's VALUES clause never grows unbounded.
const MAX_CANDIDATES = 20;

// Wikidata precision codes: 11 = day, 10 = month, 9 = year, 8 = decade,
// 7 = century. Only an explicit "11" claims day precision. Every other
// value, including decade, century, and any absent or malformed code,
// maps to "year", the coarsest value the enum offers. Bias runs toward
// understatement, never toward a confidence no source gave us.
export function precisionFromWikidata(raw: string | undefined): DatePrecision {
  if (raw === "11") return "day";
  if (raw === "10") return "month";
  if (raw === "9") return "year";
  return "year";
}

function qidFromUri(uri: string): string {
  return uri.split("/").pop() ?? uri;
}

// A Wikidata QID is the letter Q followed by one or more digits (Q1,
// Q45875, ...). getBook, getSeries, and getSeriesEntries below splice their
// externalId argument directly into a SPARQL query string via BIND, and
// that argument reaches here straight from an anonymous POST /api/track
// request body (src/app/api/track/route.ts -> src/lib/discover.ts ->
// getSeriesEntriesFromAll), so it must be validated as a real QID shape
// before it touches the query text. Without this, a crafted externalId can
// close the BIND clause and append arbitrary SPARQL, including a SERVICE
// clause pointing at an attacker-chosen endpoint, executed from our IP
// against the public WDQS. A value that fails this check simply is not a
// Wikidata entity id, so every call site below treats it as "found
// nothing" rather than throwing: a malformed row in a batch should not
// fail a refresh for every other book in the same slice.
const QID_PATTERN = /^Q\d+$/;

export function isValidQid(value: string): boolean {
  return QID_PATTERN.test(value);
}

async function sparql(query: string, signal?: AbortSignal): Promise<Record<string, unknown>[]> {
  const url = `${ENDPOINT}?query=${encodeURIComponent(query)}&format=json`;
  const data = await fetchJson(url, {
    headers: { accept: "application/sparql-results+json", "user-agent": USER_AGENT },
    signal,
  });

  const record = asRecord(data);
  if (!record) return [];

  const results = asRecord(record.results);
  if (!results) return [];

  return asArray(results.bindings)
    .map((b) => asRecord(b))
    .filter((b): b is Record<string, unknown> => b !== null);
}

function bindingValue(binding: Record<string, unknown>, key: string): string | undefined {
  const field = asRecord(binding[key]);
  return field ? asString(field.value) : undefined;
}

function entriesQuery(seriesQid: string): string {
  return `
    SELECT ?book ?bookLabel ?ordinal ?pubDate ?precision ?seriesLabel WHERE {
      BIND(wd:${seriesQid} AS ?series)
      ?book p:P179 ?membership .
      ?membership ps:P179 wd:${seriesQid} .
      OPTIONAL { ?membership pq:P1545 ?ordinal . }
      OPTIONAL {
        ?book p:P577 ?dateStatement .
        ?dateStatement psv:P577 ?dateValue .
        ?dateValue wikibase:timeValue ?pubDate .
        ?dateValue wikibase:timePrecision ?precision .
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    ORDER BY ?ordinal
  `;
}

interface SearchCandidate {
  qid: string;
  label: string;
}

// wbsearchentities is Wikidata's full-text entity search: fast, index-backed,
// and scoped to the query text from the start. This replaces a SPARQL query
// that used to scan every "instance of / subclass of literary work" entity
// in Wikidata before filtering by label, which took 65+ seconds and 504'd in
// production. Search only narrows candidates down to a small set of QIDs;
// enrichmentQuery below fills in series/date detail for exactly those QIDs.
// Pulled out of searchEntities so the response-shape parsing can be unit
// tested directly against a parsed JSON object, without going through
// fetchJson or a mocked network call.
export function candidatesFromSearchResponse(data: unknown): SearchCandidate[] {
  const record = asRecord(data);
  if (!record) return [];

  return asArray(record.search)
    .map((hit) => asRecord(hit))
    .filter((hit): hit is Record<string, unknown> => hit !== null)
    .map((hit): SearchCandidate | null => {
      const qid = asString(hit.id);
      const label = asString(hit.label);
      if (!qid || !label) return null;
      // Guarded here as well as at the client-facing entry points. These qids
      // come from Wikidata's own search response rather than from a request
      // body, so this is not the injection path A7 named. It is guarded
      // anyway because buildValuesClause interpolates them into SPARQL, and
      // "the upstream is trustworthy" is a claim about someone else's server
      // that this code cannot check. Dropping a candidate whose id is not
      // shaped like a QID costs nothing: it could not have been enriched.
      if (!isValidQid(qid)) return null;
      return { qid, label };
    })
    .filter((c): c is SearchCandidate => c !== null);
}

async function searchEntities(text: string, signal?: AbortSignal): Promise<SearchCandidate[]> {
  const url =
    `${SEARCH_ENDPOINT}?action=wbsearchentities&search=${encodeURIComponent(text)}` +
    `&language=en&format=json&type=item&limit=${MAX_CANDIDATES}`;
  const data = await fetchJson(url, {
    headers: { "user-agent": USER_AGENT },
    signal,
  });

  return candidatesFromSearchResponse(data);
}

// Exported for a direct unit test; also used to build the VALUES clause in
// enrichmentQuery below.
export function buildValuesClause(qids: string[]): string {
  return qids.map((qid) => `wd:${qid}`).join(" ");
}

// Enriches an already-narrowed set of candidate QIDs with series membership
// (P179/P1545) and publication date (P577), the same shape entriesQuery
// fetches for a known series, just parameterised over specific book entities
// via VALUES instead of walking from a series id.
function enrichmentQuery(qids: string[]): string {
  return `
    SELECT ?book ?ordinal ?pubDate ?precision ?series ?seriesLabel WHERE {
      VALUES ?book { ${buildValuesClause(qids)} }
      OPTIONAL { ?book p:P179 ?membership . ?membership ps:P179 ?series . OPTIONAL { ?membership pq:P1545 ?ordinal . } }
      OPTIONAL {
        ?book p:P577 ?ds . ?ds psv:P577 ?dv .
        ?dv wikibase:timeValue ?pubDate .
        ?dv wikibase:timePrecision ?precision .
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
  `;
}

function toProviderBook(binding: Record<string, unknown>): ProviderBook | null {
  const bookUri = bindingValue(binding, "book");
  const title = bindingValue(binding, "bookLabel");
  if (!bookUri || !title) return null;

  const rawDate = bindingValue(binding, "pubDate");
  const ordinal = bindingValue(binding, "ordinal");
  const authorLabel = bindingValue(binding, "authorLabel");
  const seriesLabel = bindingValue(binding, "seriesLabel");

  return {
    provider: "wikidata",
    externalId: qidFromUri(bookUri),
    title,
    authors: authorLabel ? [authorLabel] : [],
    seriesName: seriesLabel,
    seriesPosition: ordinal ? Number(ordinal) : undefined,
    releaseDate: rawDate ? rawDate.slice(0, 10) : undefined,
    datePrecision: rawDate
      ? precisionFromWikidata(bindingValue(binding, "precision"))
      : undefined,
    sourceUrl: bookUri.replace(
      "http://www.wikidata.org/entity/",
      "https://www.wikidata.org/wiki/",
    ),
  };
}

// Builds a ProviderBook from a search candidate (title comes from
// wbsearchentities, which already matched on the query text) plus its
// matching enrichment binding, if the batched SPARQL call found one. A
// candidate with no enrichment binding (e.g. no series/date statements on
// Wikidata yet) still yields a book, just without that extra detail, the
// same way Google Books results can be noisy or partial.
function toProviderBookFromCandidate(
  candidate: SearchCandidate,
  binding: Record<string, unknown> | undefined,
): ProviderBook {
  const rawDate = binding ? bindingValue(binding, "pubDate") : undefined;
  const precision = binding ? bindingValue(binding, "precision") : undefined;
  const ordinal = binding ? bindingValue(binding, "ordinal") : undefined;
  const seriesLabel = binding ? bindingValue(binding, "seriesLabel") : undefined;
  const seriesUri = binding ? bindingValue(binding, "series") : undefined;

  return {
    provider: "wikidata",
    externalId: candidate.qid,
    title: candidate.label,
    authors: [],
    seriesName: seriesLabel,
    seriesExternalId: seriesUri ? qidFromUri(seriesUri) : undefined,
    seriesPosition: ordinal ? Number(ordinal) : undefined,
    releaseDate: rawDate ? rawDate.slice(0, 10) : undefined,
    datePrecision: rawDate ? precisionFromWikidata(precision) : undefined,
    sourceUrl: `https://www.wikidata.org/wiki/${candidate.qid}`,
  };
}

export const wikidataProvider: MetadataProvider = {
  name: "wikidata",
  official: true,

  async searchBooks(query, signal) {
    const candidates = await searchEntities(query, signal);
    if (candidates.length === 0) return [];

    const qids = candidates.map((c) => c.qid);
    const bindings = await sparql(enrichmentQuery(qids), signal);

    const byQid = new Map<string, Record<string, unknown>>();
    for (const binding of bindings) {
      const bookUri = bindingValue(binding, "book");
      if (bookUri) byQid.set(qidFromUri(bookUri), binding);
    }

    return candidates.map((candidate) =>
      toProviderBookFromCandidate(candidate, byQid.get(candidate.qid)),
    );
  },

  async getBook(externalId, signal) {
    if (!isValidQid(externalId)) return null;
    const bindings = await sparql(
      `SELECT ?book ?bookLabel ?pubDate ?precision WHERE {
         BIND(wd:${externalId} AS ?book)
         OPTIONAL {
           ?book p:P577 ?ds . ?ds psv:P577 ?dv .
           ?dv wikibase:timeValue ?pubDate .
           ?dv wikibase:timePrecision ?precision .
         }
         SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
       }`,
      signal,
    );
    return bindings[0] ? toProviderBook(bindings[0]) : null;
  },

  async getSeries(externalId, signal) {
    if (!isValidQid(externalId)) return null;
    const bindings = await sparql(
      `SELECT ?book ?bookLabel WHERE {
         BIND(wd:${externalId} AS ?book)
         SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
       }`,
      signal,
    );
    const label = bindings[0] ? bindingValue(bindings[0], "bookLabel") : undefined;
    if (!label) return null;
    const result: ProviderSeries = {
      provider: "wikidata",
      externalId,
      title: label,
      sourceUrl: `https://www.wikidata.org/wiki/${externalId}`,
    };
    return result;
  },

  async getSeriesEntries(externalId, signal) {
    if (!isValidQid(externalId)) return [];
    const bindings = await sparql(entriesQuery(externalId), signal);
    return bindings
      .map(toProviderBook)
      .filter((b): b is ProviderBook => b !== null)
      .map((book) => ({ ...book, seriesExternalId: externalId }));
  },
};
