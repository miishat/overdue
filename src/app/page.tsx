import { MarkShelfViewed } from "@/components/shelf/MarkShelfViewed";
import { WaitingShelf } from "@/components/shelf/WaitingShelf";
import { getCurrentUserId } from "@/lib/current-user";
import { changedBookIds, drizzleSeenStore } from "@/lib/seen";
import { drizzleShelfSource, loadShelf } from "@/lib/shelf";

// The shelf must reflect whatever was tracked a moment ago, not whatever was
// true at the last deploy. Force request-time rendering so a static build
// never freezes it. See node_modules/next/dist/docs/01-app/02-guides/
// caching-without-cache-components.md, "Route segment config" > `dynamic`.
export const dynamic = "force-dynamic";

export default async function Home() {
  const now = new Date();
  const userId = await getCurrentUserId();

  // Read the baseline and compute badges before anything advances it. The
  // advance itself happens later, client-side, after this render has
  // painted (see MarkShelfViewed); doing it here instead would mark a
  // change seen before the user had a chance to look at it, which is the
  // exact failure this feature exists to prevent.
  const [entries, since] = await Promise.all([
    loadShelf(drizzleShelfSource, now),
    drizzleSeenStore.lastViewedAt(userId),
  ]);
  const changeRows = await drizzleSeenStore.changesSince(userId, since);
  const changedIds = changedBookIds({ rows: changeRows, since });

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 font-display text-[26px] text-body">Waiting</h1>
      <WaitingShelf entries={entries} now={now} changedIds={changedIds} />
      <MarkShelfViewed viewedAt={now} />
    </main>
  );
}
