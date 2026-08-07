import {
  DATE_PRECISIONS,
  PROVIDER_NAMES,
  type DatePrecision,
  type ProviderName,
} from "@/db/schema/enums";
import { isSafeCoverUrl } from "@/lib/covers";
import { isValidClientReleaseDate } from "@/lib/tracks";
import { asRecord } from "@/providers/http";
import type { ResolvedBook } from "@/resolution/resolve";

/**
 * Narrowing guards for the untrusted body of POST /api/track, following the
 * same pattern as isReadStateValue (src/lib/read-state.ts) and
 * isValidClientReleaseDate (src/lib/tracks.ts): a guard that rejects,
 * rather than a cast that trusts. `as Partial<TrackRequest>` let an
 * anonymous request write title, coverUrl, description, seriesName,
 * confidence, releaseDate, datePrecision, and arbitrary (provider,
 * externalId) pairs into shared catalog tables with no checks at all. An
 * invalid provider or datePrecision previously reached a Postgres enum
 * column and surfaced as a 500; every guard below is meant to turn that
 * into a 400 instead.
 *
 * Every bound here is deliberately generous for real book metadata and
 * deliberately finite, so a single request cannot write an unbounded blob
 * into a table every user's shelf reads from. Nothing here truncates or
 * coerces: a value outside a bound is rejected outright, so a caller that
 * sent something wrong learns that instead of having it silently reshaped.
 */

// A few hundred characters covers the longest real titles, including
// subtitles ("... : A Novel"); 500 leaves headroom without allowing a
// title-shaped field to carry a paragraph.
export const MAX_TITLE_LENGTH = 500;

// Real author names are well under this; also bounds how much text one
// entry in the authors array can carry.
export const MAX_AUTHOR_NAME_LENGTH = 200;

// A book can plausibly list several co-authors, translators, or editors,
// but not hundreds. Capping the array keeps upsertAuthors's per-author
// loop in persist.ts (three statements per entry) from being handed an
// effectively unbounded amount of work by one request.
export const MAX_AUTHORS = 20;

// Jacket copy and encyclopedia-style summaries top out well under this;
// 5,000 characters is roughly a page of text, generous for a genuine
// description while refusing a request that tries to write a megabyte of
// text into a shared column.
export const MAX_TEXT_FIELD_LENGTH = 5000;

// Series titles are short by nature; matches MAX_TITLE_LENGTH's reasoning.
export const MAX_SERIES_NAME_LENGTH = 500;

// Provider ids we actually see are short (Hardcover's integer ids,
// Wikidata QIDs, ISBN-13s); 200 characters is generous headroom for any of
// those without allowing an arbitrary blob into a column meant to hold an
// id, and without approaching the size where a SPARQL-injection payload
// (see src/providers/wikidata.ts) needs meaningful space to work with.
export const MAX_EXTERNAL_ID_LENGTH = 200;

// The catalog has five providers today (see PROVIDER_NAMES), so a book can
// carry at most one source per provider under normal operation. 20 leaves
// room to grow without accepting an unbounded array that would be resolved
// and persisted in one request.
export const MAX_SOURCES = 20;

// Common practical URL length limits sit around 2,000 characters (the
// limit older browsers and some infrastructure imposed on a full URL).
// sourceUrl is never fetched server-side, only stored and displayed, but
// it is still free text and gets the same "bounded, not unbounded" rule
// as everything else in this module.
export const MAX_SOURCE_URL_LENGTH = 2000;

/**
 * Narrowing guard rather than a cast, so an unknown value from a request
 * body cannot reach a Postgres enum column as a bad member. Derived from
 * PROVIDER_NAMES (src/db/schema/enums.ts), the same constant the enum
 * column itself is built from, so the two cannot drift apart.
 */
export function isProviderName(value: unknown): value is ProviderName {
  return typeof value === "string" && (PROVIDER_NAMES as readonly string[]).includes(value);
}

/**
 * Same reasoning as isProviderName, for the date_precision enum column.
 */
export function isDatePrecisionValue(value: unknown): value is DatePrecision {
  return typeof value === "string" && (DATE_PRECISIONS as readonly string[]).includes(value);
}

export type TrackBookValidation =
  | { ok: true; book: ResolvedBook }
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/**
 * Validates the untrusted `book` field of a POST /api/track body and, on
 * success, returns it narrowed to ResolvedBook. Every error message names
 * the field and the rule it broke, never the value that broke it, so a
 * caller cannot use this endpoint to get its own oversized or malformed
 * input echoed back.
 */
export function validateTrackBook(value: unknown): TrackBookValidation {
  const record = asRecord(value);
  if (!record) return fail("book must be an object");

  const title = record.title;
  if (typeof title !== "string" || title.trim().length === 0) {
    return fail("book.title is required and must be a non-empty string");
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return fail(`book.title must be at most ${MAX_TITLE_LENGTH} characters`);
  }

  const key = record.key;
  if (typeof key !== "string" || key.trim().length === 0) {
    return fail("book.key is required and must be a non-empty string");
  }

  const authorsRaw = record.authors;
  if (!Array.isArray(authorsRaw)) {
    return fail("book.authors must be an array of strings");
  }
  if (authorsRaw.length > MAX_AUTHORS) {
    return fail(`book.authors must contain at most ${MAX_AUTHORS} entries`);
  }
  const authors: string[] = [];
  for (const entry of authorsRaw) {
    if (typeof entry !== "string" || entry.length > MAX_AUTHOR_NAME_LENGTH) {
      return fail(
        `each book.authors entry must be a string of at most ${MAX_AUTHOR_NAME_LENGTH} characters`,
      );
    }
    authors.push(entry);
  }

  const seriesNameRaw = record.seriesName;
  if (seriesNameRaw !== undefined) {
    if (typeof seriesNameRaw !== "string" || seriesNameRaw.length > MAX_SERIES_NAME_LENGTH) {
      return fail(`book.seriesName must be a string of at most ${MAX_SERIES_NAME_LENGTH} characters`);
    }
  }
  const seriesName = seriesNameRaw as string | undefined;

  const seriesExternalIdRaw = record.seriesExternalId;
  if (seriesExternalIdRaw !== undefined) {
    if (
      typeof seriesExternalIdRaw !== "string" ||
      seriesExternalIdRaw.length > MAX_EXTERNAL_ID_LENGTH
    ) {
      return fail(
        `book.seriesExternalId must be a string of at most ${MAX_EXTERNAL_ID_LENGTH} characters`,
      );
    }
  }
  const seriesExternalId = seriesExternalIdRaw as string | undefined;

  const seriesPositionRaw = record.seriesPosition;
  if (seriesPositionRaw !== undefined) {
    if (typeof seriesPositionRaw !== "number" || !Number.isFinite(seriesPositionRaw)) {
      return fail("book.seriesPosition must be a finite number");
    }
  }
  const seriesPosition = seriesPositionRaw as number | undefined;

  const isbn13Raw = record.isbn13;
  if (isbn13Raw !== undefined) {
    if (typeof isbn13Raw !== "string" || isbn13Raw.length > MAX_EXTERNAL_ID_LENGTH) {
      return fail(`book.isbn13 must be a string of at most ${MAX_EXTERNAL_ID_LENGTH} characters`);
    }
  }
  const isbn13 = isbn13Raw as string | undefined;

  const coverUrlRaw = record.coverUrl;
  if (coverUrlRaw !== undefined) {
    // isSafeCoverUrl (src/lib/covers.ts) is the one place that decides
    // whether this app is willing to render a URL as an <img src>. Reused
    // here rather than re-implementing a second rule, closing the gap
    // where /api/track wrote books.cover_url unvalidated and the cover
    // proxy fetched whatever landed there.
    if (typeof coverUrlRaw !== "string" || !isSafeCoverUrl(coverUrlRaw)) {
      return fail("book.coverUrl is not a URL this app can render as a cover");
    }
  }
  const coverUrl = coverUrlRaw as string | undefined;

  const descriptionRaw = record.description;
  if (descriptionRaw !== undefined) {
    if (typeof descriptionRaw !== "string" || descriptionRaw.length > MAX_TEXT_FIELD_LENGTH) {
      return fail(`book.description must be a string of at most ${MAX_TEXT_FIELD_LENGTH} characters`);
    }
  }
  const description = descriptionRaw as string | undefined;

  // A client-supplied null would clear a stored date; isValidClientReleaseDate
  // (src/lib/tracks.ts) documents why that channel is refused outright for
  // an anonymous request. Reused here instead of duplicating the rule.
  if (!isValidClientReleaseDate(record.releaseDate)) {
    return fail("book.releaseDate must be a date string or omitted");
  }
  const releaseDate = record.releaseDate as string | undefined;

  const datePrecisionRaw = record.datePrecision;
  if (datePrecisionRaw !== undefined && !isDatePrecisionValue(datePrecisionRaw)) {
    return fail("book.datePrecision must be a known precision value");
  }
  const datePrecision = datePrecisionRaw as DatePrecision | undefined;

  const confidenceRaw = record.confidence;
  if (
    typeof confidenceRaw !== "number" ||
    !Number.isFinite(confidenceRaw) ||
    confidenceRaw < 0 ||
    confidenceRaw > 100
  ) {
    return fail("book.confidence must be a finite number between 0 and 100");
  }
  const confidence = confidenceRaw;

  const provenanceRaw = asRecord(record.provenance);
  if (record.provenance !== undefined && !provenanceRaw) {
    return fail("book.provenance must be an object");
  }
  if (provenanceRaw) {
    for (const fieldValue of Object.values(provenanceRaw)) {
      if (fieldValue !== undefined && !isProviderName(fieldValue)) {
        return fail("book.provenance may only name known providers");
      }
    }
  }
  const provenance = (provenanceRaw ?? {}) as ResolvedBook["provenance"];

  const sourcesRaw = record.sources;
  if (!Array.isArray(sourcesRaw)) {
    return fail("book.sources must be an array");
  }
  if (sourcesRaw.length > MAX_SOURCES) {
    return fail(`book.sources must contain at most ${MAX_SOURCES} entries`);
  }
  const sources: ResolvedBook["sources"] = [];
  for (const entryValue of sourcesRaw) {
    const entry = asRecord(entryValue);
    if (!entry) return fail("each book.sources entry must be an object");

    if (!isProviderName(entry.provider)) {
      return fail("each book.sources entry must name a known provider");
    }

    if (typeof entry.externalId !== "string" || entry.externalId.length === 0) {
      return fail("each book.sources entry requires a non-empty externalId");
    }
    if (entry.externalId.length > MAX_EXTERNAL_ID_LENGTH) {
      return fail(`each book.sources externalId must be at most ${MAX_EXTERNAL_ID_LENGTH} characters`);
    }

    if (entry.sourceUrl !== undefined) {
      if (typeof entry.sourceUrl !== "string" || entry.sourceUrl.length > MAX_TEXT_FIELD_LENGTH) {
        return fail(`each book.sources sourceUrl must be a string of at most ${MAX_TEXT_FIELD_LENGTH} characters`);
      }
    }

    if (entry.releaseDate !== undefined && !isValidClientReleaseDate(entry.releaseDate)) {
      return fail("each book.sources releaseDate must be a date string or omitted");
    }

    if (entry.datePrecision !== undefined && !isDatePrecisionValue(entry.datePrecision)) {
      return fail("each book.sources datePrecision must be a known precision value");
    }

    sources.push({
      provider: entry.provider,
      externalId: entry.externalId,
      sourceUrl: entry.sourceUrl as string | undefined,
      releaseDate: entry.releaseDate as string | undefined,
      datePrecision: entry.datePrecision as DatePrecision | undefined,
    });
  }

  const book: ResolvedBook = {
    key,
    title,
    authors,
    seriesName,
    seriesExternalId,
    seriesPosition,
    isbn13,
    coverUrl,
    description,
    releaseDate,
    datePrecision,
    provenance,
    sources,
    confidence,
  };

  return { ok: true, book };
}

export interface ValidatedManualInput {
  title: string;
  author?: string;
  notes?: string;
  sourceUrl?: string;
}

export type ManualInputValidation =
  | ({ ok: true } & ValidatedManualInput)
  | { ok: false; error: string };

/**
 * Validates the body of POST /api/manual. Same guard-not-cast reasoning as
 * validateTrackBook above: `as Partial<ManualRequest>` let an untrusted
 * author, notes, or sourceUrl field of any length or type reach
 * persistResolvedBook, and a non-string title would previously throw at
 * `body.title?.trim()` (a TypeError, surfaced as a 500) rather than being
 * rejected with a 400.
 */
export function validateManualInput(value: unknown): ManualInputValidation {
  const record = asRecord(value);
  if (!record) return fail("body must be an object");

  const titleRaw = record.title;
  if (typeof titleRaw !== "string") {
    return fail("title is required and must be a string");
  }
  const title = titleRaw.trim();
  if (title.length === 0) {
    return fail("title is required");
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return fail(`title must be at most ${MAX_TITLE_LENGTH} characters`);
  }

  let author: string | undefined;
  if (record.author !== undefined) {
    if (typeof record.author !== "string") {
      return fail("author must be a string");
    }
    if (record.author.length > MAX_AUTHOR_NAME_LENGTH) {
      return fail(`author must be at most ${MAX_AUTHOR_NAME_LENGTH} characters`);
    }
    const trimmed = record.author.trim();
    author = trimmed.length > 0 ? trimmed : undefined;
  }

  let notes: string | undefined;
  if (record.notes !== undefined) {
    if (typeof record.notes !== "string") {
      return fail("notes must be a string");
    }
    if (record.notes.length > MAX_TEXT_FIELD_LENGTH) {
      return fail(`notes must be at most ${MAX_TEXT_FIELD_LENGTH} characters`);
    }
    const trimmed = record.notes.trim();
    notes = trimmed.length > 0 ? trimmed : undefined;
  }

  let sourceUrl: string | undefined;
  if (record.sourceUrl !== undefined) {
    if (typeof record.sourceUrl !== "string") {
      return fail("sourceUrl must be a string");
    }
    if (record.sourceUrl.length > MAX_SOURCE_URL_LENGTH) {
      return fail(`sourceUrl must be at most ${MAX_SOURCE_URL_LENGTH} characters`);
    }
    const trimmed = record.sourceUrl.trim();
    sourceUrl = trimmed.length > 0 ? trimmed : undefined;
  }

  return { ok: true, title, author, notes, sourceUrl };
}
