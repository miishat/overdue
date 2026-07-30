import { notFound } from "next/navigation";
import { Gap } from "@/components/shelf/Gap";
import { StatusRule } from "@/components/shelf/StatusRule";
import { DateColumn } from "@/components/shelf/DateColumn";
import type { ReadStateValue } from "@/db/schema/enums";
import { drizzleReadStateStore, readStatesFor } from "@/lib/read-state";
import { drizzleSeriesDetailSource, loadSeriesDetail } from "@/lib/series-detail";

// Series detail reads the database on every visit, same as the shelf and
// Library: a static build would freeze the run at build time, and a newly
// released or newly tracked book would never show up. See src/app/page.tsx
// and node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-
// components.md, "Route segment config" > `dynamic`.
export const dynamic = "force-dynamic";

// Larger than the shelf's 48px cover width (src/components/shelf/ShelfRow.tsx)
// so a gap in the run reads as a legible cover-shaped hole rather than a
// small dash easy to miss. This is the point of this screen: the shape of
// the series, gaps included, legible at a glance.
const RUN_COVER_WIDTH = 96;

const READ_STATE_LABELS: Record<ReadStateValue, string> = {
  want: "Want",
  reading: "Reading",
  read: "Read",
  skipped: "Skipped",
};

export default async function SeriesDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const now = new Date();

  const detail = await loadSeriesDetail(drizzleSeriesDetailSource, id, now);
  if (!detail) notFound();

  const bookIds = detail.run
    .map((entry) => entry.bookId)
    .filter((bookId): bookId is string => bookId !== null);
  const readStates = await readStatesFor(bookIds, drizzleReadStateStore);

  const seriesComplete = detail.series.seriesStatus === "complete";

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-1 font-display text-[26px] text-body">
        {detail.series.seriesTitle}
      </h1>
      {seriesComplete ? (
        <p className="mb-6 font-mono text-[11px] uppercase text-verdigris">
          Series complete
        </p>
      ) : (
        <div className="mb-6" />
      )}

      {detail.run.length === 0 ? (
        <p className="py-16 text-center font-display text-[18px] text-body">
          No books in this series yet.
        </p>
      ) : (
        <div>
          {detail.run.map((entry) => {
            const readState = entry.bookId
              ? readStates.get(entry.bookId)
              : undefined;

            return (
              <div
                key={entry.key}
                className="grid items-center gap-3 border-b border-rule py-3"
                style={{
                  gridTemplateColumns: `${RUN_COVER_WIDTH}px 1fr auto auto`,
                  gridTemplateAreas: '"cover identity status date"',
                }}
              >
                <div data-slot="cover" style={{ gridArea: "cover" }}>
                  {entry.coverUrl ? (
                    <img
                      src={entry.coverUrl}
                      alt={entry.title}
                      width={RUN_COVER_WIDTH}
                      height={RUN_COVER_WIDTH * 1.5}
                      className="block border border-rule"
                    />
                  ) : (
                    <Gap width={RUN_COVER_WIDTH} />
                  )}
                </div>

                <div data-slot="identity" style={{ gridArea: "identity" }}>
                  <span className="block font-display text-[15px] text-body">
                    {entry.title}
                  </span>
                  {entry.authorName ? (
                    <span className="block text-[12px] text-quiet">
                      {entry.authorName}
                    </span>
                  ) : null}
                  {readState ? (
                    <span className="block font-mono text-[11px] uppercase text-verdigris">
                      {READ_STATE_LABELS[readState]}
                    </span>
                  ) : null}
                </div>

                <div
                  data-slot="status"
                  style={{ gridArea: "status" }}
                  className="flex h-full items-stretch"
                >
                  <StatusRule status={entry.status} />
                </div>

                <div data-slot="date" style={{ gridArea: "date" }}>
                  <DateColumn entry={entry} now={now} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
