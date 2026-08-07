import {
  DATE_PRECISIONS,
  PROVIDER_NAMES,
  type DatePrecision,
  type ProviderName,
} from "@/db/schema/enums";
import { isSafeCoverUrl } from "@/lib/covers";
import { asRecord } from "@/providers/http";
import type { ResolvedBook } from "@/resolution/resolve";

/**
 * Narrowing guards for the untrusted body of POST /api/track, following the
 * same pattern as isReadStateValue (src/lib/read-state.ts): a guard that
 * rejects, rather than a cast that trusts. `as Partial<TrackRequest>` let an
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
 *
 * This module imports no database client and never will: every guard below
 * is a pure predicate over an `unknown` value. isValidClientReleaseDate used
 * to live in src/lib/tracks.ts, which imports @/db/client (throws without
 * DATABASE_URL), so importing it dragged a database dependency into a module
 * that otherwise has none, forcing src/lib/catalog-input.test.ts into a
 * DATABASE_URL placeholder and a beforeAll dynamic import purely to dodge
 * module evaluation order. It now lives here, alongside this module's other
 * pure guards (isProviderName, isDatePrecisionValue), which is its natural
 * home: it guards the same untrusted request body they do.
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
//
// This is now the one bound for every sourceUrl in this module. It used to
// differ by call site: book.sources[].sourceUrl was bound by
// MAX_TEXT_FIELD_LENGTH (5000) while /api/manual's sourceUrl was bound by
// this constant (2000), two different limits on what is conceptually the
// same field. Unified on the tighter of the two.
export const MAX_SOURCE_URL_LENGTH = 2000;

// book.key never reaches the database (persist.ts never writes it to a
// column; it exists only for in-process comparisons, e.g. route.ts's
// `entry.key === book.key` when filtering discovered series entries). It
// was the one string field in this module with no length bound at all.
// Impact is nil since nothing downstream persists it, but this module's own
// rule is bounded, not unbounded, for every field, not just the ones that
// reach a column. Generous enough to hold /api/manual's derived key (title
// plus author; see stableExternalId in src/app/api/manual/route.ts) with
// headroom to spare.
export const MAX_KEY_LENGTH = 1000;

// series_position is numeric(6, 2) in src/db/schema/catalog.ts: 6 total
// digits, 2 after the decimal point, so the largest magnitude it can store
// is 9999.99. A seriesPosition at or past 10000 in magnitude used to pass
// this validator, reach persist.ts's `.toString()`, and raise a Postgres
// "numeric field overflow" with no try/catch anywhere on the route to turn
// it into a 400 (the exact failure the audit's E1 finding named).
export const MAX_SERIES_POSITION_MAGNITUDE = 10000;

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

/**
 * Narrowing guard rather than a cast, so an untrusted /api/track request
 * body cannot reach persistResolvedBook with a releaseDate shaped in a way
 * ResolvedBook was never meant to carry from outside the resolver.
 *
 * ResolvedBook.releaseDate accepts null to mean an authoritative withdrawal
 * (see the comment on that field in src/resolution/resolve.ts), a channel
 * added for a source that can genuinely assert "no date". No provider
 * adapter can produce that value today, and an untrusted HTTP client is not
 * a provider either: a caller of this route who wants to correct a date can
 * always submit the corrected string, and there is no legitimate reason for
 * an anonymous request body to clear a date the app already has for a book.
 * So this predicate accepts only a present, non-empty date string or an
 * absent field, and rejects a client-supplied null outright rather than
 * letting it through as a withdrawal.
 *
 * CHOSEN (item 2 of the review): require a full YYYY-MM-DD and reject a
 * partial date ("2027" or "2027-01") rather than normalise it to one.
 * persist.ts writes this value straight into releases.date, a Postgres
 * `date` column that has no partial form; "2027" and "2027-01" are not
 * valid `date` literals and used to reach the column unrejected, raising
 * the same class of 500 this module exists to close off. Normalising a
 * partial to a full date (e.g. treating "2027" as "2027-01-01") was
 * rejected as the fix: this project already found and fixed exactly that
 * defect in the Hardcover adapter (see precisionForHardcoverDate in
 * src/providers/hardcover.ts), where a bare placeholder year arrived as a
 * January 1 date and rendered as a confirmed release nobody confirmed. A
 * partial date is a precision claim, and date_precision is the field this
 * app built to carry that claim; releaseDate itself only ever carries a
 * full day. A client that means "sometime in 2027" has no way to say so
 * through this field today, and must omit it (optionally pairing a
 * datePrecision on its own) rather than have this guard invent a day for
 * it. No caller in this codebase depends on the partial forms: every
 * provider adapter (google-books.ts, hardcover.ts, wikidata.ts) already
 * normalises its own releaseDate to a full YYYY-MM-DD before it reaches
 * ResolvedBook, so this only tightens what an anonymous request body may
 * assert, not what a real resolution ever produces.
 */
export function isValidClientReleaseDate(value: unknown): value is string | undefined {
  if (value === undefined) return true;
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * A URL-shaped guard for sourceUrl, the one URL field this app stores but
 * never fetches server-side and does not yet render as an <a href> (see
 * src/lib/book-detail.ts, which already selects it into the detail model).
 * Deliberately not isSafeCoverUrl (src/lib/covers.ts) reused: that guard
 * also forbids a non-default port, a rule that exists specifically because
 * a stored cover URL becomes a blind, server-side fetch through the cover
 * proxy, which turns a non-default port into a port-scan primitive. A
 * sourceUrl is never fetched by this server, only stored and eventually
 * clicked as a link, so a publisher's site running on a non-default port is
 * a legitimate sourceUrl that isSafeCoverUrl's port rule would wrongly
 * reject. What both guards share, and what this one exists to enforce, is
 * refusing a scheme other than http(s), so a stored value can never become
 * a javascript: payload waiting for the first component that renders it.
 */
export function isSafeSourceUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "http:" || url.protocol === "https:";
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
  if (key.length > MAX_KEY_LENGTH) {
    return fail(`book.key must be at most ${MAX_KEY_LENGTH} characters`);
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
    // Mirrors the series_position column's numeric(6, 2) bound. See
    // MAX_SERIES_POSITION_MAGNITUDE above for why this specific value.
    if (Math.abs(seriesPositionRaw) >= MAX_SERIES_POSITION_MAGNITUDE) {
      return fail(
        `book.seriesPosition magnitude must be less than ${MAX_SERIES_POSITION_MAGNITUDE}`,
      );
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
  // above documents why that channel is refused outright for an anonymous
  // request, and why a partial date is rejected rather than normalised.
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
      if (typeof entry.sourceUrl !== "string" || entry.sourceUrl.length > MAX_SOURCE_URL_LENGTH) {
        return fail(`each book.sources sourceUrl must be a string of at most ${MAX_SOURCE_URL_LENGTH} characters`);
      }
      // isSafeSourceUrl (see above) refuses a scheme other than http(s), so
      // a javascript: value can never be stored waiting for a future
      // renderer. An empty string is left alone here: it carries no scheme
      // to police and is already accepted as "no url" elsewhere in this
      // module (see validateManualInput's sourceUrl handling below).
      if (entry.sourceUrl.length > 0 && !isSafeSourceUrl(entry.sourceUrl)) {
        return fail("each book.sources sourceUrl must be an http or https URL");
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
    // See isSafeSourceUrl above for why this is not isSafeCoverUrl. A
    // whitespace-only sourceUrl is treated as "no url" (unchanged from
    // before), so the scheme check only runs once something is left.
    if (trimmed.length > 0 && !isSafeSourceUrl(trimmed)) {
      return fail("sourceUrl must be an http or https URL");
    }
    sourceUrl = trimmed.length > 0 ? trimmed : undefined;
  }

  return { ok: true, title, author, notes, sourceUrl };
}
