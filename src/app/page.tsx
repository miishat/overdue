import { WaitingShelf } from "@/components/shelf/WaitingShelf";
import { drizzleShelfSource, loadShelf } from "@/lib/shelf";

// The shelf must reflect whatever was tracked a moment ago, not whatever was
// true at the last deploy. Force request-time rendering so a static build
// never freezes it. See node_modules/next/dist/docs/01-app/02-guides/
// caching-without-cache-components.md, "Route segment config" > `dynamic`.
export const dynamic = "force-dynamic";

export default async function Home() {
  const now = new Date();
  const entries = await loadShelf(drizzleShelfSource, now);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 font-display text-[26px] text-body">Waiting</h1>
      <WaitingShelf entries={entries} now={now} />
    </main>
  );
}
