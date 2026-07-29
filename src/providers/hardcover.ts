import type { MetadataProvider, ProviderBook, ProviderSeries } from "./types";
import { asArray, asNumber, asRecord, asString, fetchJson } from "./http";

const ENDPOINT = "https://api.hardcover.app/v1/graphql";

// Depth 3 maximum: books -> book_series -> series. Do not nest further.
const SEARCH_QUERY = `
  query SearchBooks($q: String!) {
    books(where: { title: { _ilike: $q } }, limit: 20) {
      id
      title
      description
      release_date
      image { url }
      contributions { author { name } }
      book_series { position series { id name } }
    }
  }
`;

// Same shape as SEARCH_QUERY but keyed by id. Written out rather than
// derived by string replacement, so a change to one cannot silently
// corrupt the other.
const BOOK_QUERY = `
  query GetBook($id: Int!) {
    books(where: { id: { _eq: $id } }, limit: 1) {
      id
      title
      description
      release_date
      image { url }
      contributions { author { name } }
      book_series { position series { id name } }
    }
  }
`;

const SERIES_QUERY = `
  query GetSeries($id: Int!) {
    series(where: { id: { _eq: $id } }, limit: 1) {
      id
      name
    }
  }
`;

const SERIES_ENTRIES_QUERY = `
  query GetSeriesEntries($id: Int!) {
    series(where: { id: { _eq: $id } }, limit: 1) {
      id
      name
      book_series {
        position
        book { id title release_date contributions { author { name } } }
      }
    }
  }
`;

async function query<T>(
  document: string,
  variables: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T | null> {
  const token = process.env.HARDCOVER_API_TOKEN;
  if (!token) return null;

  const data = await fetchJson(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query: document, variables }),
    signal,
  });

  const record = asRecord(data);
  if (!record) return null;

  const errors = asArray(record.errors);
  if (errors.length > 0) return null;

  const dataField = asRecord(record.data);
  return (dataField as T) ?? null;
}

function toAuthors(contributions: unknown): string[] {
  return asArray(contributions)
    .map((c) => asRecord(c))
    .map((c) => (c ? asRecord(c.author) : null))
    .map((author) => (author ? asString(author.name) : undefined))
    .filter((n): n is string => Boolean(n));
}

function toProviderBook(bookValue: unknown): ProviderBook | null {
  const book = asRecord(bookValue);
  if (!book) return null;

  const id = asNumber(book.id);
  const title = asString(book.title);
  if (id === undefined || !title) return null;

  const bookSeries = asArray(book.book_series)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  const membership = bookSeries[0];
  const membershipSeries = membership ? asRecord(membership.series) : null;
  const seriesId = membershipSeries ? asNumber(membershipSeries.id) : undefined;
  const seriesName = membershipSeries ? asString(membershipSeries.name) : undefined;
  const seriesPosition = membership ? asNumber(membership.position) : undefined;

  const image = asRecord(book.image);
  const releaseDate = asString(book.release_date);

  return {
    provider: "hardcover",
    externalId: String(id),
    title,
    authors: toAuthors(book.contributions),
    seriesName,
    seriesExternalId: seriesId !== undefined ? String(seriesId) : undefined,
    seriesPosition,
    coverUrl: image ? asString(image.url) : undefined,
    description: asString(book.description),
    releaseDate,
    datePrecision: releaseDate ? "day" : undefined,
    sourceUrl: `https://hardcover.app/books/${id}`,
  };
}

export const hardcoverProvider: MetadataProvider = {
  name: "hardcover",
  official: true,

  async searchBooks(q, signal) {
    const data = await query<Record<string, unknown>>(SEARCH_QUERY, { q: `%${q}%` }, signal);
    if (!data) return [];
    return asArray(data.books)
      .map(toProviderBook)
      .filter((b): b is ProviderBook => b !== null);
  },

  async getBook(externalId, signal) {
    const data = await query<Record<string, unknown>>(
      BOOK_QUERY,
      { id: Number(externalId) },
      signal,
    );
    if (!data) return null;
    const book = asArray(data.books)[0];
    return book ? toProviderBook(book) : null;
  },

  async getSeries(externalId, signal) {
    const data = await query<Record<string, unknown>>(
      SERIES_QUERY,
      { id: Number(externalId) },
      signal,
    );
    if (!data) return null;
    const found = asRecord(asArray(data.series)[0]);
    if (!found) return null;

    const id = asNumber(found.id);
    const name = asString(found.name);
    if (id === undefined || !name) return null;

    const result: ProviderSeries = {
      provider: "hardcover",
      externalId: String(id),
      title: name,
      sourceUrl: `https://hardcover.app/series/${id}`,
    };
    return result;
  },

  async getSeriesEntries(externalId, signal) {
    const data = await query<Record<string, unknown>>(
      SERIES_ENTRIES_QUERY,
      { id: Number(externalId) },
      signal,
    );
    if (!data) return [];

    const series = asRecord(asArray(data.series)[0]);
    if (!series) return [];

    const entries = asArray(series.book_series)
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== null);

    return entries
      .map((entry): ProviderBook | null => {
        const mapped = toProviderBook(entry.book);
        if (!mapped) return null;
        return {
          ...mapped,
          seriesExternalId: externalId,
          seriesPosition: asNumber(entry.position),
        };
      })
      .filter((b): b is ProviderBook => b !== null);
  },
};
