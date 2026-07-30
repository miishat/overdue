import { notFound } from "next/navigation";
import { ReadStateControl } from "@/components/ReadStateControl";
import { Gap } from "@/components/shelf/Gap";
import { ProvenanceStamp } from "@/components/shelf/ProvenanceStamp";
import { drizzleBookDetailSource, loadBookDetail } from "@/lib/book-detail";
import { formatImprecise, formatMove } from "@/lib/provenance";
import { drizzleReadStateStore, readStatesFor } from "@/lib/read-state";

// Book detail reads the database on every visit, same reasoning as Series
// detail and Library: a static build would freeze the page at build time,
// and a newly verified date or a freshly logged change would never show up.
// See src/app/series/[id]/page.tsx and node_modules/next/dist/docs/01-app/
// 02-guides/caching-without-cache-components.md, "Route segment config" >
// `dynamic`.
export const dynamic = "force-dynamic";

const COVER_WIDTH = 160;

export default async function BookDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const now = new Date();

  const book = await loadBookDetail(drizzleBookDetailSource, id);
  if (!book) notFound();

  const readStates = await readStatesFor([book.id], drizzleReadStateStore);
  const readState = readStates.get(book.id) ?? null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-8 flex gap-4">
        <div data-slot="cover">
          {book.coverUrl ? (
            <img
              src={book.coverUrl}
              alt={book.title}
              width={COVER_WIDTH}
              height={COVER_WIDTH * 1.5}
              className="block border border-rule"
            />
          ) : (
            <Gap width={COVER_WIDTH} />
          )}
        </div>
        <div>
          <h1 className="font-display text-[26px] text-body">{book.title}</h1>
          {book.authorNames.length > 0 ? (
            <p className="text-[14px] text-quiet">
              {book.authorNames.join(", ")}
            </p>
          ) : null}
          {book.description ? (
            <p className="mt-2 max-w-prose text-[14px] text-body">
              {book.description}
            </p>
          ) : null}
          <div className="mt-4">
            <ReadStateControl bookId={book.id} initialState={readState} />
          </div>
        </div>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 font-mono text-[11px] uppercase text-quiet">
          Release records
        </h2>
        {book.releases.length === 0 ? (
          <p className="text-[14px] text-quiet">No release records yet.</p>
        ) : (
          <ul>
            {book.releases.map((release) => (
              <li
                key={release.id}
                className="border-b border-rule py-3 last:border-b-0"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-display text-[15px] text-body">
                    {release.date && release.precision
                      ? formatImprecise(release.date, release.precision)
                      : "No date"}
                  </span>
                  <span className="font-mono text-[11px] uppercase text-quiet">
                    {release.region} · {release.format}
                  </span>
                </div>
                {release.sources.length > 0 ? (
                  <ul className="mt-1 flex flex-col gap-1">
                    {release.sources.map((source, index) => (
                      <li key={`${release.id}-${source.provider}-${index}`}>
                        <ProvenanceStamp
                          provider={source.provider}
                          lastVerifiedAt={source.lastVerifiedAt}
                          now={now}
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-mono text-[11px] uppercase text-quiet">
          Change history
        </h2>
        {book.changes.length === 0 ? (
          <p className="text-[14px] text-quiet">No recorded date changes.</p>
        ) : (
          <ul>
            {book.changes.map((change, index) => {
              const move = formatMove({ from: change.from, to: change.to });
              return (
                <li
                  key={`${change.observedAt.toISOString()}-${index}`}
                  className="border-b border-rule py-2 last:border-b-0"
                >
                  <ProvenanceStamp
                    provider={change.provider}
                    lastVerifiedAt={change.observedAt}
                    now={now}
                    move={move}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
