import type { DatePrecision } from "@/db/schema/enums";
import type { MetadataProvider, ProviderBook, ProviderSeries } from "./types";
import { asArray, asNumber, asRecord, asString, fetchJson } from "./http";

const ENDPOINT = "https://api.hardcover.app/v1/graphql";

// Hardcover's Hasura backend rejects `_ilike` (and related) filters outright:
// HTTP 403 :: {"error":"ilike and related operations are not permitted on
// this server."}. Book search has to go through the dedicated,
// Typesense-backed `search` endpoint instead of a `where` filter.
// See https://docs.hardcover.app/api/guides/searching/.
//
// Depth 2: search -> results. `results` is an opaque JSON scalar produced by
// Typesense (it has no GraphQL sub-selection), so this cannot be nested
// further and stays well under the max query depth of 3.
const SEARCH_QUERY = `
  query SearchBooks($q: String!) {
    search(query: $q, query_type: "Book", per_page: 20, page: 1) {
      results
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

  // Hardcover's token settings page hands out the value with a "Bearer "
  // prefix already attached; a bare token (as used in tests) has none.
  // Accept either shape rather than risking a doubled-up "Bearer Bearer ..."
  // header, which Hasura rejects as malformed.
  const authorization = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

  const data = await fetchJson(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization,
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

// The search endpoint's Typesense documents represent numeric ids as
// strings (e.g. "id": "2463545"), unlike the Hasura `books`/`series`
// queries where the same field comes back as a JSON number. Accept either.
function toId(value: unknown): number | undefined {
  const asNum = asNumber(value);
  if (asNum !== undefined) return asNum;
  const asStr = asString(value);
  if (asStr === undefined) return undefined;
  const parsed = Number(asStr);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// Hardcover's API returns a bare date string with no precision field at all,
// and it stores approximate future dates as January 1 of the target year.
// Left unguarded, "sometime in 2027" arrives as "2027-01-01" and gets
// rendered as a confirmed date nobody confirmed. Treat any bare January 1
// date as year precision instead.
//
// Judgment call: this applies to any January 1 date, past or future, and
// does not take the current time as an input. We cannot distinguish a year
// placeholder from a genuine January 1 release, and the honest response to
// that ambiguity is the lower confidence claim. The accepted cost is that a
// book genuinely published on January 1 displays as just its year,
// understating by a few weeks. The alternative asserts a date nobody
// confirmed, which is the failure this app exists to prevent. Keeping this
// function pure, with no "now" parameter, also keeps it trivially testable.
// The shape check is not ceremony. release_date arrives through asString,
// which guarantees a string and nothing about its form, so a bare "2027" or
// a malformed value would slice to something that is not "01-01" and fall
// through to a day claim: the exact bug this function exists to prevent,
// reintroduced by the input we failed to look at. Anything that is not a
// full YYYY-MM-DD gets year precision, for the same reason the January 1
// case does.
const FULL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function precisionForHardcoverDate(date: string | undefined): DatePrecision | undefined {
  if (!date) return undefined;
  if (!FULL_DATE.test(date)) return "year";
  return date.slice(5, 10) === "01-01" ? "year" : "day";
}

// Maps a Typesense "document" from the search endpoint's results.hits[] to
// a ProviderBook. This is a different shape than the Hasura `books` row
// used by getBook/getSeriesEntries (see toProviderBook below), so it gets
// its own mapping function rather than being forced into the same one.
function toProviderBookFromSearchDocument(documentValue: unknown): ProviderBook | null {
  const document = asRecord(documentValue);
  if (!document) return null;

  const id = toId(document.id);
  const title = asString(document.title);
  if (id === undefined || !title) return null;

  const featuredSeries = asRecord(document.featured_series);
  const seriesInfo = featuredSeries ? asRecord(featuredSeries.series) : null;
  const seriesId = seriesInfo ? toId(seriesInfo.id) : undefined;
  const seriesName = seriesInfo ? asString(seriesInfo.name) : undefined;
  const seriesPosition = featuredSeries ? asNumber(featuredSeries.position) : undefined;

  const authors = asArray(document.author_names)
    .map((name) => asString(name))
    .filter((name): name is string => Boolean(name));

  const image = asRecord(document.image);
  const releaseDate = asString(document.release_date);

  return {
    provider: "hardcover",
    externalId: String(id),
    title,
    authors,
    seriesName,
    seriesExternalId: seriesId !== undefined ? String(seriesId) : undefined,
    seriesPosition,
    coverUrl: image ? asString(image.url) : undefined,
    description: asString(document.description),
    releaseDate,
    datePrecision: precisionForHardcoverDate(releaseDate),
    sourceUrl: `https://hardcover.app/books/${id}`,
  };
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
    datePrecision: precisionForHardcoverDate(releaseDate),
    sourceUrl: `https://hardcover.app/books/${id}`,
  };
}

export const hardcoverProvider: MetadataProvider = {
  name: "hardcover",
  official: true,

  async searchBooks(q, signal) {
    const data = await query<Record<string, unknown>>(SEARCH_QUERY, { q }, signal);
    if (!data) return [];

    const search = asRecord(data.search);
    if (!search) return [];

    const results = asRecord(search.results);
    if (!results) return [];

    const hits = asArray(results.hits)
      .map((hit) => asRecord(hit))
      .filter((hit): hit is Record<string, unknown> => hit !== null);

    return hits
      .map((hit) => toProviderBookFromSearchDocument(hit.document))
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

    const seriesName = asString(series.name);

    return entries
      .map((entry): ProviderBook | null => {
        const mapped = toProviderBook(entry.book);
        if (!mapped) return null;
        return {
          ...mapped,
          seriesName,
          seriesExternalId: externalId,
          seriesPosition: asNumber(entry.position),
        };
      })
      .filter((b): b is ProviderBook => b !== null);
  },
};
