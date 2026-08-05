import type { DatePrecision, ProviderName } from "@/db/schema/enums";

/** U+00B7 middle dot with a single space either side, per the spec. */
const SEP = " · ";

const MS_PER_DAY = 86_400_000;

export function wholeDaysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * Which source said so, and how long ago we checked.
 * Format: `WIKIDATA · CHK 6d`
 *
 * The unit shortens as the gap grows so the stamp stays narrow enough to sit
 * beside a date in a dense list.
 */
export function formatStamp(input: {
  provider: ProviderName;
  lastVerifiedAt: Date;
  now: Date;
}): string {
  const days = Math.max(0, wholeDaysBetween(input.lastVerifiedAt, input.now));
  const label = input.provider.toUpperCase();

  let age: string;
  if (days <= 30) {
    age = `${days}d`;
  } else {
    const weeks = Math.floor(days / 7);
    age = weeks <= 52 ? `${weeks}w` : `${Math.floor(days / 365)}y`;
  }

  return `${label}${SEP}CHK ${age}`;
}

/**
 * A date that moved. Direction is returned rather than a colour, because the
 * caller owns the token choice: later is oxide, earlier is verdigris.
 */
export function formatMove(input: { from: Date; to: Date }): {
  label: string;
  direction: "later" | "earlier";
} {
  const days = wholeDaysBetween(input.from, input.to);
  const direction = days >= 0 ? "later" : "earlier";
  const sign = days >= 0 ? "+" : "-";
  const magnitude = Math.abs(days);

  let amount: string;
  if (magnitude < 14) {
    amount = `${magnitude}D`;
  } else if (magnitude < 365) {
    amount = `${Math.floor(magnitude / 7)}W`;
  } else {
    amount = `${Math.floor(magnitude / 365)}Y`;
  }

  return { label: `MOVED ${sign}${amount}`, direction };
}

/**
 * Elapsed time since a date, for the HIATUS date column.
 *
 * HIATUS always renders this and EXPECTED never does. That is the only thing
 * distinguishing two states that otherwise share "no rule, blank date", so
 * this is load-bearing rather than decorative.
 */
export function formatElapsed(from: Date, now: Date): string {
  const days = Math.max(0, wholeDaysBetween(from, now));
  const years = Math.floor(days / 365);

  if (years >= 1) return years === 1 ? "1 yr" : `${years} yrs`;

  // Below 30 days, a month bucket always reads "0 mo", which looks like
  // broken software rather than a true reading. Callers on a sub-month
  // timescale (Settings device health) need day resolution here; callers on
  // a year timescale (HIATUS) never pass a span this short, so this branch
  // does not change their output.
  if (days < 30) return days === 1 ? "1 day" : `${days} days`;

  const months = Math.floor(days / 30);
  return `${months} mo`;
}

/**
 * Season storage convention: seasons are stored on their first month in the
 * Northern Hemisphere. Winter starts December (11), Spring starts March (2),
 * Summer starts June (5), Fall starts September (8). The lookup table below
 * maps month indices to these season starts. This is deliberate and differs
 * from a simple calendar-quarter division, which would incorrectly split
 * seasons across month boundaries. See formatImprecise().
 */
const SEASONS: Record<number, string> = {
  0: "Winter",
  2: "Spring",
  5: "Summer",
  8: "Fall",
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Render a stored date at the precision it was actually known to.
 *
 * "Fall 2027" is stored as 2027-09-01 with precision season. Rendering it as
 * "1 Sep 2027" would assert a confidence no source gave us, which is the
 * dishonesty this whole app exists to avoid.
 */
export function formatImprecise(
  date: Date,
  precision: DatePrecision,
): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();

  switch (precision) {
    case "day":
      return `${date.getUTCDate()} ${MONTH_SHORT[month]} ${year}`;
    case "month":
      return `${MONTH_NAMES[month]} ${year}`;
    case "quarter":
      return `Q${Math.floor(month / 3) + 1} ${year}`;
    case "season": {
      // Seasons are stored on their first month, so fall back to the nearest
      // season start rather than returning undefined on an off-month date.
      const seasonMap = [0, 0, 2, 2, 2, 5, 5, 5, 8, 8, 8, 0];
      const start = seasonMap[month];
      return `${SEASONS[start]} ${year}`;
    }
    case "year":
      return String(year);
  }
}
