import { formatElapsed, formatImprecise } from "@/lib/provenance";
import type { ShelfEntry } from "@/lib/synthesise";

/**
 * The time axis. Holds a date, a window, or is honestly empty.
 *
 * HIATUS is the one state that renders something without having a date: the
 * elapsed time since the series last saw a release. EXPECTED renders nothing.
 * That difference is the only visual separator between them, since both also
 * have no left rule.
 */
export function DateColumn({
  entry,
  now,
}: {
  entry: ShelfEntry;
  now: Date;
}) {
  let text = "";

  if (entry.date && entry.precision) {
    text = formatImprecise(entry.date, entry.precision);
  } else if (entry.status === "HIATUS" && entry.lastSeriesReleaseAt) {
    text = formatElapsed(entry.lastSeriesReleaseAt, now);
  }

  return (
    <span
      data-date-column
      className="font-mono text-[13px] tabular-nums text-quiet"
    >
      {text}
    </span>
  );
}
