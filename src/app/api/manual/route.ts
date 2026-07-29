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

export async function POST(request: Request): Promise<Response> {
  const userId = await getCurrentUserId();

  const body = (await request.json()) as Partial<ManualRequest>;
  const title = body.title?.trim();
  if (!title) {
    return Response.json({ error: "title is required" }, { status: 400 });
  }

  const author = body.author?.trim();

  const book: ResolvedBook = {
    key: `manual:${title.toLowerCase()}`,
    title,
    authors: author ? [author] : [],
    description: body.notes?.trim() || undefined,
    provenance: { title: "manual", authors: "manual" },
    sources: [
      {
        provider: "manual",
        externalId: `manual:${Date.now()}`,
        sourceUrl: body.sourceUrl?.trim() || undefined,
      },
    ],
    confidence: 100,
  };

  const { bookId } = await persistResolvedBook(book);
  await insertTrack(userId, { seriesId: null, bookId });

  return Response.json({ bookId }, { status: 201 });
}
