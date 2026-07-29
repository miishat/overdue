import type { MetadataProvider, ProviderBook } from "./types";
import { normaliseIsbn13 } from "./types";
import { asArray, asNumber, asRecord, asString, fetchJson } from "./http";

const SEARCH = "https://openlibrary.org/search.json";
const COVERS = "https://covers.openlibrary.org/b/id";

function toProviderBook(docValue: unknown): ProviderBook | null {
  const doc = asRecord(docValue);
  if (!doc) return null;

  const key = asString(doc.key);
  const title = asString(doc.title);
  if (!key || !title) return null;

  const externalId = key.replace("/works/", "");
  const authors = asArray(doc.author_name).filter((a): a is string => typeof a === "string");

  const isbns = asArray(doc.isbn).filter((i): i is string => typeof i === "string");
  const isbn13 = isbns.map(normaliseIsbn13).find((i) => i !== null);

  const coverId = asNumber(doc.cover_i);
  const firstPublishYear = asNumber(doc.first_publish_year);

  return {
    provider: "openlibrary",
    externalId,
    title,
    authors,
    isbn13: isbn13 ?? undefined,
    coverUrl: coverId ? `${COVERS}/${coverId}-L.jpg` : undefined,
    releaseDate: firstPublishYear ? `${firstPublishYear}-01-01` : undefined,
    datePrecision: firstPublishYear ? "year" : undefined,
    sourceUrl: `https://openlibrary.org${key}`,
  };
}

export const openLibraryProvider: MetadataProvider = {
  name: "openlibrary",
  official: false,

  async searchBooks(query, signal) {
    const url = `${SEARCH}?q=${encodeURIComponent(query)}&limit=20&fields=key,title,author_name,first_publish_year,cover_i,isbn`;
    const data = await fetchJson(url, { signal });
    const record = asRecord(data);
    if (!record) return [];
    return asArray(record.docs)
      .map(toProviderBook)
      .filter((b): b is ProviderBook => b !== null);
  },

  async getBook(externalId, signal) {
    const data = await fetchJson(`https://openlibrary.org/works/${externalId}.json`, { signal });
    const work = asRecord(data);
    if (!work) return null;

    const title = asString(work.title);
    if (!title) return null;

    const covers = asArray(work.covers).filter((c): c is number => typeof c === "number");

    return {
      provider: "openlibrary",
      externalId,
      title,
      authors: [],
      coverUrl: covers[0] ? `${COVERS}/${covers[0]}-L.jpg` : undefined,
      sourceUrl: `https://openlibrary.org/works/${externalId}`,
    };
  },

  async getSeries() {
    return null;
  },

  async getSeriesEntries() {
    return [];
  },
};
