import type {
  DatePrecision,
  ReleaseStatus,
  SeriesStatus,
} from "@/db/schema/enums";

export interface StatusInput {
  now: Date;
  date: Date | null;
  precision: DatePrecision | null;
  hasBookRecord: boolean;
  sourceOfficial: boolean;
  seriesStatus: SeriesStatus | null;
  lastSeriesReleaseAt: Date | null;
  hiatusThresholdYears: number;
}

function isSameOrBefore(a: Date, b: Date): boolean {
  return a.getTime() <= b.getTime();
}

export function deriveStatus(input: StatusInput): ReleaseStatus {
  // 1. A finished series stops everything else.
  if (input.seriesStatus === "complete" && !input.hasBookRecord) {
    return "COMPLETE";
  }

  if (input.date) {
    // 2. Today counts as released.
    if (isSameOrBefore(input.date, input.now)) return "RELEASED";
    // 3. An exact future date is confirmed.
    if (input.precision === "day") return "DATED";
    // 4. Anything coarser is a window.
    return "ESTIMATED";
  }

  if (input.hasBookRecord) {
    // 5 and 6. The book exists but carries no date.
    return input.sourceOfficial ? "ANNOUNCED" : "RUMORED";
  }

  // 7 and 8. No record at all, so the series itself decides.
  if (!input.lastSeriesReleaseAt) return "EXPECTED";

  // Calculate the anniversary date by adding years to the release date's year component.
  // For example, a release on 2024-02-29 + 2 years becomes 2026-02-29, which doesn't exist,
  // so JavaScript's setUTCFullYear rolls it to 2026-03-01. The anniversary is treated as this
  // rolled date, making the boundary check calendar-exact rather than approximated by 365.25 days.
  // We use UTC methods throughout to ensure a machine's local timezone cannot affect the result.
  const anniversaryDate = new Date(input.lastSeriesReleaseAt);
  anniversaryDate.setUTCFullYear(
    input.lastSeriesReleaseAt.getUTCFullYear() + input.hiatusThresholdYears,
  );

  return isSameOrBefore(anniversaryDate, input.now) ? "HIATUS" : "EXPECTED";
}
