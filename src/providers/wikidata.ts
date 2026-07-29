import type { DatePrecision } from "@/db/schema/enums";
import { asArray, asRecord, asString, fetchJson } from "./http";
import type { MetadataProvider, ProviderBook, ProviderSeries } from "./types";

const ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT = "Overdue/1.0 (book release tracker)";

export function precisionFromWikidata(raw: string | undefined): DatePrecision {
  if (raw === "9") return "year";
  if (raw === "10") return "month";
  return "day";
}

function qidFromUri(uri: string): string {
  return uri.split("/").pop() ?? uri;
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

function searchQuery(text: string): string {
  const escaped = text.replace(/"/g, '\\"');
  return `
    SELECT ?book ?bookLabel ?ordinal ?pubDate ?precision WHERE {
      ?book wdt:P31/wdt:P279* wd:Q7725634 .
      ?book rdfs:label ?bookLabel .
      FILTER(CONTAINS(LCASE(?bookLabel), LCASE("${escaped}")) && LANG(?bookLabel) = "en")
      OPTIONAL { ?book p:P179 ?m . ?m pq:P1545 ?ordinal . }
      OPTIONAL {
        ?book p:P577 ?ds . ?ds psv:P577 ?dv .
        ?dv wikibase:timeValue ?pubDate .
        ?dv wikibase:timePrecision ?precision .
      }
    }
    LIMIT 20
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

export const wikidataProvider: MetadataProvider = {
  name: "wikidata",
  official: true,

  async searchBooks(query, signal) {
    const bindings = await sparql(searchQuery(query), signal);
    return bindings.map(toProviderBook).filter((b): b is ProviderBook => b !== null);
  },

  async getBook(externalId, signal) {
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
    const bindings = await sparql(entriesQuery(externalId), signal);
    return bindings
      .map(toProviderBook)
      .filter((b): b is ProviderBook => b !== null)
      .map((book) => ({ ...book, seriesExternalId: externalId }));
  },
};
