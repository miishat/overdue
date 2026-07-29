import type { DatePrecision } from "@/db/schema/enums";
import type { MetadataProvider, ProviderBook } from "./types";
import { normaliseIsbn13 } from "./types";
import { asArray, asRecord, asString, fetchJson } from "./http";

const ENDPOINT = "https://www.googleapis.com/books/v1/volumes";

export function parsePublishedDate(
  raw: string | undefined,
): { date: string; precision: DatePrecision } | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { date: raw, precision: "day" };
  if (/^\d{4}-\d{2}$/.test(raw)) return { date: `${raw}-01`, precision: "month" };
  if (/^\d{4}$/.test(raw)) return { date: `${raw}-01-01`, precision: "year" };
  return null;
}

function toProviderBook(volumeValue: unknown): ProviderBook | null {
  const volume = asRecord(volumeValue);
  if (!volume) return null;

  const id = asString(volume.id);
  const info = asRecord(volume.volumeInfo);
  const title = info ? asString(info.title) : undefined;
  if (!id || !info || !title) return null;

  const authors = info ? asArray(info.authors).filter((a): a is string => typeof a === "string") : [];
  const publishedDate = asString(info.publishedDate);
  const parsed = parsePublishedDate(publishedDate);

  const identifiers = asArray(info.industryIdentifiers)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  const isbnRaw = identifiers.find((entry) => asString(entry.type) === "ISBN_13");
  const isbnString = isbnRaw ? asString(isbnRaw.identifier) : undefined;

  const imageLinks = asRecord(info.imageLinks);
  const thumbnail = imageLinks ? asString(imageLinks.thumbnail) : undefined;

  return {
    provider: "google",
    externalId: id,
    title,
    authors,
    isbn13: isbnString ? (normaliseIsbn13(isbnString) ?? undefined) : undefined,
    coverUrl: thumbnail?.replace(/^http:/, "https:"),
    description: asString(info.description),
    releaseDate: parsed?.date,
    datePrecision: parsed?.precision,
    sourceUrl: `https://books.google.com/books?id=${id}`,
  };
}

export const googleBooksProvider: MetadataProvider = {
  name: "google",
  official: false,

  async searchBooks(query, signal) {
    const url = `${ENDPOINT}?q=${encodeURIComponent(query)}&maxResults=20`;
    const data = await fetchJson(url, { signal });
    const record = asRecord(data);
    if (!record) return [];
    return asArray(record.items)
      .map(toProviderBook)
      .filter((b): b is ProviderBook => b !== null);
  },

  async getBook(externalId, signal) {
    const data = await fetchJson(`${ENDPOINT}/${externalId}`, { signal });
    return toProviderBook(data);
  },

  async getSeries() {
    return null;
  },

  async getSeriesEntries() {
    return [];
  },
};
