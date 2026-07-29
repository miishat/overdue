import { getCurrentUserId } from "@/lib/current-user";
import { discoverSeriesEntries } from "@/lib/discover";
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

  // Tracking a series means the app owns finding the rest of the run. The
  // user's track was already created above, so a provider outage during
  // discovery must not fail the request, it should just leave the rest of
  // the series to be filled in by a later refresh.
  if (body.scope === "series") {
    const refs = body.book.sources
      .filter((s) => s.provider === "hardcover" || s.provider === "wikidata")
      .map((s) => ({ provider: s.provider, externalId: s.externalId }));

    try {
      const entries = await discoverSeriesEntries(refs);
      for (const entry of entries) {
        if (entry.key === body.book.key) continue;
        await persistResolvedBook(entry);
      }
    } catch (error) {
      console.error("Series discovery failed", error);
    }
  }

  return Response.json({ bookId, seriesId }, { status: 201 });
}
