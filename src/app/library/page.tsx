import { LibraryGrid } from "@/components/library/LibraryGrid";
import { getCurrentUserId } from "@/lib/current-user";
import { drizzleReadStateStore, readStatesFor } from "@/lib/read-state";
import { drizzleShelfSource, loadLibrary } from "@/lib/shelf";

// Library reads the database on every visit, same as the shelf: a static
// build would freeze the list at build time and newly tracked books, or a
// series completing, would never show up. See src/app/page.tsx and
// node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-
// components.md, "Route segment config" > `dynamic`.
export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const now = new Date();
  const entries = await loadLibrary(drizzleShelfSource, now);

  // COMPLETE is a property of Series.status, not of any one book, so there
  // is no synthetic "complete" entry to filter for. The series' real books
  // already appear in `entries` via loadShelf (tracks reachable through a
  // series resolve to their books); what's missing is only the completion
  // marker, so fetch tracked series the same way loadShelf resolves the
  // user, and mark the series ids whose status is complete.
  const userId = await getCurrentUserId();
  const trackedSeries = await drizzleShelfSource.trackedSeries(userId);
  const completeSeriesIds = new Set(
    trackedSeries
      .filter((s) => s.seriesStatus === "complete")
      .map((s) => s.seriesId),
  );

  const bookIds = entries
    .map((entry) => entry.bookId)
    .filter((id): id is string => id !== null);
  const readStates = await readStatesFor(bookIds, drizzleReadStateStore);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 font-display text-[26px] text-body">Library</h1>
      <LibraryGrid
        entries={entries}
        now={now}
        readStates={readStates}
        completeSeriesIds={completeSeriesIds}
      />
    </main>
  );
}
