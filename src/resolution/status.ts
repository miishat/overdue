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

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

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

  const elapsedYears =
    (input.now.getTime() - input.lastSeriesReleaseAt.getTime()) / MS_PER_YEAR;

  return elapsedYears >= input.hiatusThresholdYears ? "HIATUS" : "EXPECTED";
}
