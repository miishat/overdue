import type { DatePrecision, ProviderName, SeriesStatus } from "@/db/schema/enums";

export interface ProviderBook {
  provider: ProviderName;
  externalId: string;
  title: string;
  authors: string[];
  seriesName?: string;
  seriesExternalId?: string;
  seriesPosition?: number;
  isbn13?: string;
  coverUrl?: string;
  description?: string;
  releaseDate?: string;
  datePrecision?: DatePrecision;
  sourceUrl?: string;
}

export interface ProviderSeries {
  provider: ProviderName;
  externalId: string;
  title: string;
  status?: SeriesStatus;
  plannedLength?: number;
  sourceUrl?: string;
}

export interface MetadataProvider {
  readonly name: ProviderName;
  readonly official: boolean;
  searchBooks(query: string, signal?: AbortSignal): Promise<ProviderBook[]>;
  getBook(externalId: string, signal?: AbortSignal): Promise<ProviderBook | null>;
  getSeries(externalId: string, signal?: AbortSignal): Promise<ProviderSeries | null>;
  getSeriesEntries(externalId: string, signal?: AbortSignal): Promise<ProviderBook[]>;
}

export function normaliseIsbn13(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  return /^\d{13}$/.test(digits) ? digits : null;
}
