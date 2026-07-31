import type { DatePrecision } from "@/db/schema/enums";
import type { PushPayload } from "@/lib/notify/payload";
import { formatImprecise, formatMove } from "@/lib/provenance";

const VALID_PRECISIONS = new Set<DatePrecision>([
  "day",
  "month",
  "quarter",
  "season",
  "year",
]);

/**
 * Render a stored date string at the precision it was actually known to.
 *
 * A missing or unrecognised precision degrades to "day" rather than
 * throwing, since the alert must always read as a sentence even if the
 * precision that came through the queue payload is somehow absent.
 */
function renderDate(value: string, precision: DatePrecision | null | undefined): string {
  const safePrecision: DatePrecision =
    precision && VALID_PRECISIONS.has(precision) ? precision : "day";
  return formatImprecise(new Date(value), safePrecision);
}

/**
 * The date change alert: an instant push fired when a single book's release
 * date moves, is set for the first time, or is withdrawn.
 *
 * The whole point of this alert is that a user learns what happened without
 * opening the app, so the body always states both the old and new dates
 * rather than just "the date moved". Each date is rendered at its OWN
 * precision, because a vague date becoming firm (a season moving to a day)
 * is a common and important case, and printing the raw stored string would
 * assert a confidence no source gave us.
 */
export function buildDateChangeAlert(input: {
  bookTitle: string;
  bookId: string;
  from: string | null;
  to: string | null;
  fromPrecision?: DatePrecision | null;
  toPrecision?: DatePrecision | null;
}): PushPayload {
  const { bookTitle, bookId, from, to, fromPrecision, toPrecision } = input;

  let body: string;
  if (from === null && to !== null) {
    body = `${bookTitle} now has a release date: ${renderDate(to, toPrecision)}.`;
  } else if (from !== null && to === null) {
    body = `${bookTitle}'s release date has been withdrawn. It was ${renderDate(from, fromPrecision)}.`;
  } else if (from !== null && to !== null) {
    const move = formatMove({ from: new Date(from), to: new Date(to) });
    const verb = move.direction === "later" ? "pushed back" : "moved up";
    body = `${bookTitle} was ${verb} from ${renderDate(from, fromPrecision)} to ${renderDate(to, toPrecision)}.`;
  } else {
    // Both null: nothing to report, but callers should not reach this.
    body = `${bookTitle}'s release date has changed.`;
  }

  return {
    title: "Release date changed",
    body,
    url: `/books/${bookId}`,
    tag: `date-change-${bookId}`,
  };
}
