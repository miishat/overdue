import type { DatePrecision } from "@/db/schema/enums";
import type { MetadataProvider, ProviderBook } from "./types";
import { normaliseIsbn13 } from "./types";

const ENDPOINT = "https://www.googleapis.com/books/v1/volumes";

interface GoogleVolume {
  id: string;
  volumeInfo?: {
    title?: string;
    authors?: string[];
    publishedDate?: string;
    description?: string;
    imageLinks?: { thumbnail?: string };
    industryIdentifiers?: { type: string; identifier: string }[];
  };
}

export function parsePublishedDate(
  raw: string | undefined,
): { date: string; precision: DatePrecision } | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { date: raw, precision: "day" };
  if (/^\d{4}-\d{2}$/.test(raw)) return { date: `${raw}-01`, precision: "month" };
  if (/^\d{4}$/.test(raw)) return { date: `${raw}-01-01`, precision: "year" };
  return null;
}

function toProviderBook(volume: GoogleVolume): ProviderBook | null {
  const info = volume.volumeInfo;
  if (!info?.title) return null;

  const parsed = parsePublishedDate(info.publishedDate);
  const isbnRaw = info.industryIdentifiers?.find(
    (i) => i.type === "ISBN_13",
  )?.identifier;

  return {
    provider: "google",
    externalId: volume.id,
    title: info.title,
    authors: info.authors ?? [],
    isbn13: isbnRaw ? (normaliseIsbn13(isbnRaw) ?? undefined) : undefined,
    coverUrl: info.imageLinks?.thumbnail?.replace(/^http:/, "https:"),
    description: info.description,
    releaseDate: parsed?.date,
    datePrecision: parsed?.precision,
    sourceUrl: `https://books.google.com/books?id=${volume.id}`,
  };
}

export const googleBooksProvider: MetadataProvider = {
  name: "google",
  official: false,

  async searchBooks(query, signal) {
    const url = `${ENDPOINT}?q=${encodeURIComponent(query)}&maxResults=20`;
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: GoogleVolume[] };
    return (data.items ?? [])
      .map(toProviderBook)
      .filter((b): b is ProviderBook => b !== null);
  },

  async getBook(externalId, signal) {
    const res = await fetch(`${ENDPOINT}/${externalId}`, { signal });
    if (!res.ok) return null;
    return toProviderBook((await res.json()) as GoogleVolume);
  },

  async getSeries() {
    return null;
  },

  async getSeriesEntries() {
    return [];
  },
};
