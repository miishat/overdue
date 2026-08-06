import Link from "next/link";
import type { ReactNode } from "react";
import { coverSrcFor } from "@/lib/covers";
import type { ShelfEntry } from "@/lib/synthesise";
import { ChangedBadge } from "./ChangedBadge";
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
  changed = false,
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
  /**
   * True when this entry changed since the user's last shelf view (Task 16).
   * Rendered inside the identity slot, not a fifth grid area: the theme
   * contract fixes the shape at four slots so M5's CSS-only theme swap keeps
   * working, so any new content has to live inside one of the existing ones.
   */
  changed?: boolean;
}) {
  // A synthetic entry is a book that does not exist yet, so it can never have
  // a cover. Guarding on synthetic rather than only on coverUrl means a stray
  // cover on a synthesised row cannot render as though the book were real.
  //
  // coverSrcFor returns null for a synthetic entry as well (no bookId to key
  // the proxy on) and for any stored url the proxy would refuse, so a cover
  // that would 404 renders as the designed absence rather than a broken
  // image icon.
  const coverSrc = entry.synthetic ? null : coverSrcFor(entry);
  const showGap = coverSrc === null;

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
      {changed ? <ChangedBadge /> : null}
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
          // Deliberately not next/image. The cover already comes from our own
          // origin at a fixed 2:3 box and a known width, behind a
          // cache-control header, and the service worker caches it by this
          // exact URL. next/image would add a second transformation layer at
          // /_next/image?url=..., spend Vercel image-optimisation quota, and
          // change the URL the worker caches, for no gain.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverSrc}
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
