import { WaitingShelf } from "@/components/shelf/WaitingShelf";
import { drizzleShelfSource, loadShelf } from "@/lib/shelf";

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
