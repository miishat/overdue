import { after } from "next/server";
import { validateTrackBook } from "@/lib/catalog-input";
import { getCurrentUserId } from "@/lib/current-user";
import { discoverSeriesEntries } from "@/lib/discover";
import { persistResolvedBook } from "@/lib/persist";
import { insertTrack } from "@/lib/tracks";
import { asRecord } from "@/providers/http";

export async function POST(request: Request): Promise<Response> {
  const userId = await getCurrentUserId();

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return Response.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const body = asRecord(parsed) ?? {};

  if (body.scope !== "series" && body.scope !== "book") {
    return Response.json(
      { error: "scope must be series or book" },
      { status: 400 },
    );
  }
  if (!body.book) {
    return Response.json({ error: "book is required" }, { status: 400 });
  }

  // validateTrackBook is a narrowing guard rather than a cast (see the
  // comment on isReadStateValue in src/lib/read-state.ts for why a guard
  // beats a cast here): it rejects a request whose book does not match
  // ResolvedBook's shape instead of trusting `as Partial<TrackRequest>` to
  // make it so. It also covers releaseDate, so a separate check for a
  // client-supplied null is no longer needed here.
  const validation = validateTrackBook(body.book);
  if (!validation.ok) {
    return Response.json({ error: validation.error }, { status: 400 });
  }
  const book = validation.book;

  const { bookId, seriesId } = await persistResolvedBook(book);

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
  //
  // Runs after the response, not inside it. Discovery is one provider round
  // trip per source plus a persist per entry, and persistResolvedBook is
  // itself several statements, so a fifteen book series was keeping the
  // user on a disabled button for the whole thing with no progress shown.
  // Nothing on screen depends on the result: the track row is already
  // written above, and the shelf reads from the database on its next render.
  //
  // Losing this work is survivable by design. `after` gets a finite budget
  // and a slow provider can outlive it, but the scheduled refresh runs
  // discovery for tracked series too, so a series left half discovered here
  // is completed by the next run rather than being stuck forever. That was
  // not true before: discovery used to happen once, at track time, and
  // never again.
  if (body.scope === "series") {
    const refs = book.sources
      .filter((s) => s.provider === "hardcover" || s.provider === "wikidata")
      .map((s) => ({ provider: s.provider, externalId: s.externalId }));

    after(async () => {
      try {
        const entries = await discoverSeriesEntries(refs);
        for (const entry of entries) {
          if (entry.key === book.key) continue;
          await persistResolvedBook(entry);
        }
      } catch (error) {
        console.error("Series discovery failed", error);
      }
    });
  }

  return Response.json({ bookId, seriesId }, { status: 201 });
}
