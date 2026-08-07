import { db } from "@/db/client";
import { tracks } from "@/db/schema/tracking";

// isValidClientReleaseDate used to live here. It moved to
// src/lib/catalog-input.ts, alongside this module's other pure guards, so
// that catalog-input.ts (which is meant to be pure, no database import) no
// longer has to reach through this file's @/db/client import just to
// validate a date string. See the module comment at the top of
// catalog-input.ts.

export async function insertTrack(
  userId: string,
  target: { seriesId: string | null; bookId: string | null },
): Promise<void> {
  await db
    .insert(tracks)
    .values({ userId, seriesId: target.seriesId, bookId: target.bookId })
    .onConflictDoNothing();
}
