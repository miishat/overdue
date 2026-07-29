import { getCurrentUserId } from "@/lib/current-user";
import { persistResolvedBook } from "@/lib/persist";
import { insertTrack } from "@/lib/tracks";
import type { ResolvedBook } from "@/resolution/resolve";

interface ManualRequest {
  title: string;
  author?: string;
  notes?: string;
  sourceUrl?: string;
}

// Normalize a string for use in deduplication keys. Trims, lowercases, and
// collapses internal whitespace. Stability is critical: this derivation is
// used to compute externalId, which the dedup path in persistResolvedBook
// depends on to recognize duplicate submissions.
function normalizeKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function POST(request: Request): Promise<Response> {
  const userId = await getCurrentUserId();

  const body = (await request.json()) as Partial<ManualRequest>;
  const title = body.title?.trim();
  if (!title) {
    return Response.json({ error: "title is required" }, { status: 400 });
  }

  const author = body.author?.trim();

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
    description: body.notes?.trim() || undefined,
    provenance: { title: "manual", authors: "manual" },
    sources: [
      {
        provider: "manual",
        externalId: stableExternalId,
        sourceUrl: body.sourceUrl?.trim() || undefined,
      },
    ],
    confidence: 100,
  };

  const { bookId } = await persistResolvedBook(book);
  await insertTrack(userId, { seriesId: null, bookId });

  return Response.json({ bookId }, { status: 201 });
}
