import Link from "next/link";
import type { ReactNode } from "react";
import type { ShelfEntry } from "@/lib/synthesise";
import { DateColumn } from "./DateColumn";
import { Gap } from "./Gap";
import { StatusRule } from "./StatusRule";

const COVER_WIDTH = 48;

/**
 * One shelf row, four slots: cover, identity, status, date.
 *
 * The theme contract: every theme reuses this exact DOM and only swaps
 * grid-template-areas and tokens. Do not branch the markup on theme. If a
 * theme ever needs a different shape it is not a theme, and the cost of
 * supporting it goes non-linear.
 */
export function ShelfRow({
  entry,
  now,
  identityExtra,
}: {
  entry: ShelfEntry;
  now: Date;
  /**
   * Extra markers appended inside the identity slot, after the series line
   * (e.g. Library's "Series complete" and read-state labels). Kept inside
   * the four-slot grid rather than as siblings below the row, so an M5
   * grid-template-areas theme swap can still position them; see series
   * detail (src/app/series/[id]/page.tsx) for the placement this matches.
   */
  identityExtra?: ReactNode;
}) {
  // A synthetic entry is a book that does not exist yet, so it can never have
  // a cover. Guarding on synthetic rather than only on coverUrl means a stray
  // cover on a synthesised row cannot render as though the book were real.
  const showGap = entry.synthetic || !entry.coverUrl;

  const href = entry.bookId
    ? `/books/${entry.bookId}`
    : entry.seriesId
      ? `/series/${entry.seriesId}`
      : null;

  const identity = (
    <>
      <span className="block font-display text-[15px] text-body">
        {entry.title}
      </span>
      {entry.authorName ? (
        <span className="block text-[12px] text-quiet">{entry.authorName}</span>
      ) : null}
      {entry.seriesTitle ? (
        <span className="block text-[12px] text-quiet">
          {entry.seriesPosition === null
            ? entry.seriesTitle
            : `${entry.seriesTitle}, book ${entry.seriesPosition}`}
        </span>
      ) : null}
      {identityExtra}
    </>
  );

  return (
    <div
      className="grid items-center gap-3 border-b border-rule py-3"
      style={{
        gridTemplateColumns: `${COVER_WIDTH}px 1fr auto auto`,
        gridTemplateAreas: '"cover identity status date"',
      }}
    >
      <div data-slot="cover" style={{ gridArea: "cover" }}>
        {showGap ? (
          <Gap width={COVER_WIDTH} />
        ) : (
          <img
            src={entry.coverUrl as string}
            alt={entry.title}
            width={COVER_WIDTH}
            height={COVER_WIDTH * 1.5}
            className="block border border-rule"
          />
        )}
      </div>

      <div data-slot="identity" style={{ gridArea: "identity" }}>
        {href ? (
          <Link href={href} className="block no-underline">
            {identity}
          </Link>
        ) : (
          identity
        )}
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
}
