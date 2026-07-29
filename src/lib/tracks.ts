import { db } from "@/db/client";
import { tracks } from "@/db/schema/tracking";

export async function insertTrack(
  userId: string,
  target: { seriesId: string | null; bookId: string | null },
): Promise<void> {
  await db
    .insert(tracks)
    .values({ userId, seriesId: target.seriesId, bookId: target.bookId })
    .onConflictDoNothing();
}
