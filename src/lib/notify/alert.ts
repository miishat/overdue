import type { PushPayload } from "@/lib/notify/payload";
import { formatMove } from "@/lib/provenance";

/**
 * The date change alert: an instant push fired when a single book's release
 * date moves, is set for the first time, or is withdrawn.
 *
 * The whole point of this alert is that a user learns what happened without
 * opening the app, so the body always states both the old and new dates
 * rather than just "the date moved".
 */
export function buildDateChangeAlert(input: {
  bookTitle: string;
  bookId: string;
  from: string | null;
  to: string | null;
}): PushPayload {
  const { bookTitle, bookId, from, to } = input;

  let body: string;
  if (from === null && to !== null) {
    body = `${bookTitle} now has a release date: ${to}.`;
  } else if (from !== null && to === null) {
    body = `${bookTitle}'s release date has been withdrawn. It was ${from}.`;
  } else if (from !== null && to !== null) {
    const move = formatMove({ from: new Date(from), to: new Date(to) });
    const verb = move.direction === "later" ? "pushed back" : "moved up";
    body = `${bookTitle} was ${verb} from ${from} to ${to}.`;
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
