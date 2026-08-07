import { validateManualInput } from "@/lib/catalog-input";
import { getCurrentUserId } from "@/lib/current-user";
import { persistResolvedBook } from "@/lib/persist";
import { insertTrack } from "@/lib/tracks";
import type { ResolvedBook } from "@/resolution/resolve";

// Normalize a string for use in deduplication keys. Trims, lowercases, and
// collapses internal whitespace. Stability is critical: this derivation is
// used to compute externalId, which the dedup path in persistResolvedBook
// depends on to recognize duplicate submissions.
function normalizeKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function POST(request: Request): Promise<Response> {
  const userId = await getCurrentUserId();

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return Response.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  // validateManualInput is a narrowing guard rather than a cast: the old
  // `as Partial<ManualRequest>` let a non-string title reach
  // `body.title?.trim()`, throwing a TypeError (a 500) instead of a 400,
  // and let author, notes, and sourceUrl through at any length.
  const validation = validateManualInput(parsed);
  if (!validation.ok) {
    return Response.json({ error: validation.error }, { status: 400 });
  }
  const { title, author, notes, sourceUrl } = validation;

  // Generate a stable identifier from the normalized title and author.
  // The author is included if provided to distinguish books with the same
  // title by different authors. Both are normalized to collapse whitespace
  // for stability across submissions.
  const normalizedTitle = normalizeKey(title);
  const normalizedAuthor = author ? normalizeKey(author) : "";
  const externalIdParts = [normalizedTitle];
  if (normalizedAuthor) {
    externalIdParts.push(normalizedAuthor);
  }
  const stableExternalId = `manual:${externalIdParts.join(":")}`;

  const book: ResolvedBook = {
    key: `manual:${normalizedTitle}`,
    title,
    authors: author ? [author] : [],
    description: notes,
    provenance: { title: "manual", authors: "manual" },
    sources: [
      {
        provider: "manual",
        externalId: stableExternalId,
        sourceUrl,
      },
    ],
    confidence: 100,
  };

  const { bookId } = await persistResolvedBook(book);
  await insertTrack(userId, { seriesId: null, bookId });

  return Response.json({ bookId }, { status: 201 });
}
