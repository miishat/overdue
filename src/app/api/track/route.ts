import { getCurrentUserId } from "@/lib/current-user";
import { persistResolvedBook } from "@/lib/persist";
import { insertTrack } from "@/lib/tracks";
import type { ResolvedBook } from "@/resolution/resolve";

interface TrackRequest {
  book: ResolvedBook;
  scope: "series" | "book";
}

export async function POST(request: Request): Promise<Response> {
  const userId = await getCurrentUserId();

  const body = (await request.json()) as Partial<TrackRequest>;
  if (body.scope !== "series" && body.scope !== "book") {
    return Response.json(
      { error: "scope must be series or book" },
      { status: 400 },
    );
  }
  if (!body.book) {
    return Response.json({ error: "book is required" }, { status: 400 });
  }

  const { bookId, seriesId } = await persistResolvedBook(body.book);

  if (body.scope === "series" && !seriesId) {
    return Response.json(
      { error: "This book has no known series." },
      { status: 400 },
    );
  }

  await insertTrack(userId, {
    seriesId: body.scope === "series" ? seriesId : null,
    bookId: body.scope === "book" ? bookId : null,
  });

  return Response.json({ bookId, seriesId }, { status: 201 });
}
