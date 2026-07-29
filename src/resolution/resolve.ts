import type { DatePrecision, ProviderName } from "@/db/schema/enums";
import type { ProviderBook } from "@/providers/types";
import type { IdentityGroup } from "./identity";
import { RESOLVABLE_FIELDS, TRUST, type ResolvableField } from "./trust";

export interface ResolvedBook {
  key: string;
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
  provenance: Partial<Record<ResolvableField, ProviderName>>;
  sources: { provider: ProviderName; externalId: string; sourceUrl?: string }[];
  confidence: number;
}

function hasValue(book: ProviderBook, field: ResolvableField): boolean {
  const value = book[field];
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function pick(
  records: ProviderBook[],
  field: ResolvableField,
): { value: unknown; provider: ProviderName } | null {
  for (const provider of TRUST[field]) {
    const match = records.find((r) => r.provider === provider && hasValue(r, field));
    if (match) return { value: match[field], provider };
  }
  return null;
}

function computeConfidence(records: ProviderBook[]): number {
  const dated = records.filter((r) => r.releaseDate);
  if (dated.length === 0) return 40;

  const distinct = new Set(dated.map((r) => r.releaseDate)).size;
  const agreement = distinct === 1 ? 30 : -15;
  const breadth = Math.min(records.length, 4) * 5;
  const official = records.some(
    (r) => r.provider === "manual" || r.provider === "hardcover" || r.provider === "wikidata",
  )
    ? 15
    : 0;

  return Math.max(0, Math.min(100, 40 + agreement + breadth + official));
}

export function resolveGroup(group: IdentityGroup): ResolvedBook {
  const provenance: Partial<Record<ResolvableField, ProviderName>> = {};
  const resolved: Record<string, unknown> = {};

  for (const field of RESOLVABLE_FIELDS) {
    const chosen = pick(group.records, field);
    if (chosen) {
      resolved[field] = chosen.value;
      provenance[field] = chosen.provider;
    }
  }

  const dateWinner = provenance.releaseDate
    ? group.records.find(
        (r) => r.provider === provenance.releaseDate && r.releaseDate,
      )
    : undefined;

  return {
    key: group.key,
    title: (resolved.title as string) ?? group.records[0]?.title ?? "Untitled",
    authors: (resolved.authors as string[]) ?? [],
    seriesName: resolved.seriesName as string | undefined,
    seriesExternalId: resolved.seriesExternalId as string | undefined,
    seriesPosition: resolved.seriesPosition as number | undefined,
    isbn13: resolved.isbn13 as string | undefined,
    coverUrl: resolved.coverUrl as string | undefined,
    description: resolved.description as string | undefined,
    releaseDate: resolved.releaseDate as string | undefined,
    datePrecision: dateWinner?.datePrecision,
    provenance,
    sources: group.records.map((r) => ({
      provider: r.provider,
      externalId: r.externalId,
      sourceUrl: r.sourceUrl,
    })),
    confidence: computeConfidence(group.records),
  };
}
