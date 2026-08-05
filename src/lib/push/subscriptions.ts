import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { pushSubscriptions } from "@/db/schema/push";

/**
 * One row per browser or installed PWA that granted notification permission,
 * as read back from storage.
 */
export interface StoredSubscription {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
  createdAt: Date;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  failureCount: number;
}

/**
 * What the browser's Push API hands back from a subscribe call. Untrusted
 * until narrowed by `isSubscriptionInput`.
 */
export interface SubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}

export interface SubscriptionStore {
  upsert(userId: string, input: SubscriptionInput): Promise<void>;
  remove(userId: string, endpoint: string): Promise<void>;
  listFor(userId: string): Promise<StoredSubscription[]>;
  recordSuccess(id: string, at: Date): Promise<void>;
  recordFailure(id: string, at: Date): Promise<void>;
}

/**
 * Narrowing guard rather than a cast, so an unknown request body cannot
 * reach the database as a malformed subscription.
 *
 * An omitted userAgent key (value undefined) is normalised to null in
 * place, so a subscribe body that leaves userAgent out entirely is stored
 * identically to one that sends it explicitly as null. This mutates the
 * candidate object, which is the same reference the caller goes on to use
 * once this returns true.
 */
export function isSubscriptionInput(value: unknown): value is SubscriptionInput {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;

  if (
    typeof candidate.endpoint !== "string" ||
    candidate.endpoint.length === 0 ||
    typeof candidate.p256dh !== "string" ||
    typeof candidate.auth !== "string"
  ) {
    return false;
  }

  if (candidate.userAgent === undefined) {
    candidate.userAgent = null;
  }

  return candidate.userAgent === null || typeof candidate.userAgent === "string";
}

/**
 * Builds (without executing) the insert-or-update statement for a
 * subscription. Exported separately from `upsert` so tests can assert on
 * the exact statement the store issues via `.toSQL()`, rather than on a
 * copy written by hand that could drift from the real query.
 *
 * push_subscriptions has a unique constraint on endpoint (Task 1), so this
 * upsert targets that constraint: re-subscribing the same device updates
 * the existing row instead of duplicating it. Subscribing again also means
 * the device is reachable again, so any prior failure health is cleared
 * rather than left to falsely mark a recovered device as unhealthy.
 */
export function buildUpsertStatement(userId: string, input: SubscriptionInput) {
  return db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent,
        failureCount: 0,
        lastFailureAt: null,
      },
    });
}

/**
 * Builds (without executing) the success-recording statement. Exported
 * separately from `recordSuccess`, following the same pattern as
 * `buildUpsertStatement`, so tests can assert on the exact statement the
 * store issues via `.toSQL()` rather than on a hand-written copy that could
 * drift from the real query.
 *
 * A recovered device must stop showing as unhealthy in Settings, which the
 * plan calls worse than showing no health at all, so a success resets
 * `failureCount` to zero rather than leaving a stale count from before the
 * device recovered.
 */
export function buildRecordSuccessStatement(id: string, at: Date) {
  return db
    .update(pushSubscriptions)
    .set({ lastSuccessAt: at, failureCount: 0 })
    .where(eq(pushSubscriptions.id, id));
}

export const drizzleSubscriptionStore: SubscriptionStore = {
  async upsert(userId, input) {
    await buildUpsertStatement(userId, input);
  },

  async remove(userId, endpoint) {
    // Scoped by both endpoint and userId so one user's unsubscribe call
    // cannot remove a subscription that belongs to someone else.
    await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.endpoint, endpoint),
          eq(pushSubscriptions.userId, userId),
        ),
      );
  },

  async listFor(userId) {
    const rows = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));

    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      auth: row.auth,
      userAgent: row.userAgent,
      createdAt: row.createdAt,
      lastSuccessAt: row.lastSuccessAt,
      lastFailureAt: row.lastFailureAt,
      failureCount: row.failureCount,
    }));
  },

  async recordSuccess(id, at) {
    await buildRecordSuccessStatement(id, at);
  },

  async recordFailure(id, at) {
    // Incremented via a SQL expression rather than read-then-write, which
    // would race under concurrent failures for the same subscription.
    await db
      .update(pushSubscriptions)
      .set({
        lastFailureAt: at,
        failureCount: sql`${pushSubscriptions.failureCount} + 1`,
      })
      .where(eq(pushSubscriptions.id, id));
  },
};
