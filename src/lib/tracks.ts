import { db } from "@/db/client";
import { tracks } from "@/db/schema/tracking";

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
 */
export function isValidClientReleaseDate(value: unknown): value is string | undefined {
  if (value === undefined) return true;
  return typeof value === "string" && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(value);
}

export async function insertTrack(
  userId: string,
  target: { seriesId: string | null; bookId: string | null },
): Promise<void> {
  await db
    .insert(tracks)
    .values({ userId, seriesId: target.seriesId, bookId: target.bookId })
    .onConflictDoNothing();
}
