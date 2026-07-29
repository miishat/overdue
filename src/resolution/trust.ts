import type { ProviderName } from "@/db/schema/enums";

export type ResolvableField =
  | "title"
  | "authors"
  | "seriesName"
  | "seriesExternalId"
  | "seriesPosition"
  | "isbn13"
  | "coverUrl"
  | "description"
  | "releaseDate";

// Manual always wins, so it is prepended rather than repeated per row.
const ORDERS: Record<ResolvableField, ProviderName[]> = {
  title: ["hardcover", "openlibrary", "wikidata", "google"],
  authors: ["hardcover", "openlibrary", "wikidata", "google"],
  seriesName: ["hardcover", "wikidata", "openlibrary"],
  seriesExternalId: ["hardcover", "wikidata"],
  seriesPosition: ["hardcover", "wikidata"],
  isbn13: ["openlibrary", "google", "hardcover"],
  coverUrl: ["openlibrary", "hardcover", "google"],
  description: ["google", "hardcover", "openlibrary"],
  releaseDate: ["wikidata", "hardcover", "openlibrary", "google"],
};

export const TRUST: Record<ResolvableField, ProviderName[]> = Object.fromEntries(
  Object.entries(ORDERS).map(([field, order]) => [field, ["manual", ...order]]),
) as Record<ResolvableField, ProviderName[]>;

export const RESOLVABLE_FIELDS = Object.keys(TRUST) as ResolvableField[];
