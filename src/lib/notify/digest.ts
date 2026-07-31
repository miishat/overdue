import type { DatePrecision } from "@/db/schema/enums";
import type { PushPayload } from "@/lib/notify/payload";
import { formatImprecise } from "@/lib/provenance";

export interface DigestItem {
  kind: "released_today" | "upcoming" | "announced";
  bookTitle: string;
  bookId: string;
  date: string | null;
  datePrecision?: DatePrecision | null;
}

const DIGEST_TAG = "digest";

const VALID_PRECISIONS = new Set<DatePrecision>([
  "day",
  "month",
  "quarter",
  "season",
  "year",
]);

/**
 * Render a stored date string at the precision it was actually known to. A
 * missing or unrecognised precision degrades to "day" rather than throwing.
 */
function renderDate(value: string, precision: DatePrecision | null | undefined): string {
  const safePrecision: DatePrecision =
    precision && VALID_PRECISIONS.has(precision) ? precision : "day";
  return formatImprecise(new Date(value), safePrecision);
}

function describeItem(item: DigestItem): string {
  switch (item.kind) {
    case "released_today":
      return `${item.bookTitle} is out today`;
    case "upcoming":
      return item.date
        ? `${item.bookTitle} releases ${renderDate(item.date, item.datePrecision)}`
        : `${item.bookTitle} is coming up`;
    case "announced":
      return item.date
        ? `${item.bookTitle} was announced for ${renderDate(item.date, item.datePrecision)}`
        : `${item.bookTitle} was announced`;
  }
}

/**
 * The batched digest: a single notification summarizing every update since
 * the last digest, rather than one notification per book landing at once.
 *
 * Returns null for an empty list, since a digest with nothing in it must
 * never be sent, and null makes that state impossible to mistake for a
 * payload downstream.
 */
export function buildDigest(items: DigestItem[]): PushPayload | null {
  if (items.length === 0) {
    return null;
  }

  if (items.length === 1) {
    const item = items[0];
    return {
      title: "Update",
      body: `${describeItem(item)}.`,
      url: `/books/${item.bookId}`,
      tag: DIGEST_TAG,
    };
  }

  const body = items.map((item) => describeItem(item)).join(". ") + ".";

  return {
    title: `${items.length} updates`,
    body,
    url: "/",
    tag: DIGEST_TAG,
  };
}
