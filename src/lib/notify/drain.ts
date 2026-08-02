import type { DatePrecision } from "@/db/schema/enums";
import type { StoredSubscription, SubscriptionStore } from "@/lib/push/subscriptions";
import type { DateChangeQueuePayload } from "@/lib/refresh/run";
import { buildDateChangeAlert } from "./alert";
import { buildDigest, type DigestItem } from "./digest";
import type { PushPayload } from "./payload";
import type { NotificationQueuePort } from "./queue";
import { sendToAll, type PushTransport } from "./send";

export interface DrainResult {
  claimed: number;
  sent: number;
  failed: number;
}

const VALID_PRECISIONS = new Set<DatePrecision>([
  "day",
  "month",
  "quarter",
  "season",
  "year",
]);

function isPrecisionOrNullish(value: unknown): value is DatePrecision | null | undefined {
  if (value === undefined || value === null) return true;
  return typeof value === "string" && VALID_PRECISIONS.has(value as DatePrecision);
}

/**
 * Narrows the untrusted `unknown` queue payload before use, mirroring
 * isReadStateValue (src/lib/read-state.ts) and isPushPayload
 * (src/lib/notify/payload.ts): the row was written by a possibly older
 * process, so it is validated rather than cast, and a malformed row is
 * rejected instead of throwing.
 *
 * `provider` is deliberately NOT validated here: DateChangeQueuePayload
 * (shared with src/lib/refresh/run.ts, the only writer) types it as
 * `ProviderName | null`, but drainQueue never reads it, only bookId,
 * bookTitle, from, to, fromPrecision, and toPrecision feed buildDateChangeAlert.
 * Validating a field only to discard it buys nothing and risks rejecting a
 * value the writer legitimately produces (the null-provider withdrawal case)
 * if the check ever drifts from the writer's real type again.
 */
function isDateChangeQueuePayload(value: unknown): value is DateChangeQueuePayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;

  if (typeof candidate.bookId !== "string" || candidate.bookId.length === 0) {
    return false;
  }
  if (typeof candidate.bookTitle !== "string" || candidate.bookTitle.length === 0) {
    return false;
  }
  if (candidate.from !== null && typeof candidate.from !== "string") return false;
  if (candidate.to !== null && typeof candidate.to !== "string") return false;
  if (!isPrecisionOrNullish(candidate.fromPrecision)) return false;
  if (!isPrecisionOrNullish(candidate.toPrecision)) return false;

  return true;
}

const DIGEST_ITEM_KINDS = new Set(["released_today", "upcoming", "announced"]);

/** Narrows a queued "digest" row's payload to one DigestItem. */
function isDigestItemQueuePayload(value: unknown): value is DigestItem {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;

  if (typeof candidate.kind !== "string" || !DIGEST_ITEM_KINDS.has(candidate.kind)) {
    return false;
  }
  if (typeof candidate.bookTitle !== "string" || candidate.bookTitle.length === 0) {
    return false;
  }
  if (typeof candidate.bookId !== "string" || candidate.bookId.length === 0) {
    return false;
  }
  if (candidate.date !== null && typeof candidate.date !== "string") return false;
  if (!isPrecisionOrNullish(candidate.datePrecision)) return false;

  return true;
}

/**
 * Drains a user's unsent notification_queue rows and sends them.
 *
 * Date-change rows are the signature alert and each earns its own send.
 * Digest rows batch into exactly one send, honoring the batch cadence rather
 * than letting several digest rows land as several notifications.
 *
 * Rows are claimed (and marked sent) via `queue.claimUnsent` BEFORE any send
 * is attempted. That ordering is `claimUnsent`'s own contract, not something
 * this function re-implements: if a send later throws, the row must not be
 * re-claimed and re-sent on the next drain, since a duplicate notification is
 * worse than a missed one for a user who already saw it.
 */
export async function drainQueue(input: {
  userId: string;
  queue: NotificationQueuePort;
  subscriptions: StoredSubscription[];
  transport: PushTransport;
  store: SubscriptionStore;
  now: Date;
}): Promise<DrainResult> {
  const { userId, queue, subscriptions, transport, store, now } = input;

  const rows = await queue.claimUnsent(userId, now);

  const payloads: PushPayload[] = [];
  const digestItems: DigestItem[] = [];

  // Rows skipped for a malformed payload or an unrecognised kind are counted
  // into `failed` below, alongside send failures: a claimed row that never
  // produces a notification is a loss either way, and the response body must
  // show it in the one counter operators actually look at.
  let skipped = 0;

  for (const row of rows) {
    if (row.kind === "date_change") {
      if (!isDateChangeQueuePayload(row.payload)) {
        console.error(`drainQueue: skipping malformed date_change row ${row.id}`);
        skipped += 1;
        continue;
      }
      payloads.push(
        buildDateChangeAlert({
          bookTitle: row.payload.bookTitle,
          bookId: row.payload.bookId,
          from: row.payload.from,
          to: row.payload.to,
          fromPrecision: row.payload.fromPrecision,
          toPrecision: row.payload.toPrecision,
        }),
      );
    } else if (row.kind === "digest") {
      if (!isDigestItemQueuePayload(row.payload)) {
        console.error(`drainQueue: skipping malformed digest row ${row.id}`);
        skipped += 1;
        continue;
      }
      digestItems.push(row.payload);
    } else {
      console.error(`drainQueue: skipping row ${row.id} with unrecognised kind "${row.kind}"`);
      skipped += 1;
    }
  }

  // Digest rows batch into exactly one send, however many rows contributed.
  const digestPayload = buildDigest(digestItems);
  if (digestPayload) {
    payloads.push(digestPayload);
  }

  let sent = 0;
  let failed = skipped;

  for (const payload of payloads) {
    const result = await sendToAll({ subscriptions, payload, transport, store, now });
    sent += result.sent;
    failed += result.failed;
  }

  return { claimed: rows.length, sent, failed };
}
