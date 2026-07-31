import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { notificationQueue } from "@/db/schema/push";

/**
 * One row from notification_queue, ready to be sent.
 */
export interface QueuedNotification {
  id: string;
  userId: string;
  kind: string;
  payload: unknown;
  createdAt: Date;
}

/**
 * The port Task 14 drains through.
 *
 * `enqueue` has the same signature as RefreshPort.enqueue from Task 5
 * deliberately, so one Drizzle implementation satisfies both and there is
 * one writer rather than two that can diverge.
 */
export interface NotificationQueuePort {
  enqueue(userId: string, kind: string, payload: unknown): Promise<void>;
  /** Returns unsent rows and marks them sent in the same operation. */
  claimUnsent(userId: string, now: Date): Promise<QueuedNotification[]>;
}

/**
 * Builds (without executing) the claim statement: an UPDATE ... RETURNING
 * that marks unsent rows sent as it reads them, in one statement rather
 * than a SELECT followed by an UPDATE. That atomicity is what makes a
 * retry safe. A SELECT-then-UPDATE would let a crash between the two
 * statements, or two overlapping drains, claim and send the same row
 * twice; for a user who already saw the alert, a duplicate is the worse
 * failure than a lost notification. Exported separately so tests can
 * assert on the built SQL via `.toSQL()` without executing it.
 */
export function buildClaimUnsentStatement(userId: string, now: Date) {
  return db
    .update(notificationQueue)
    .set({ sentAt: now })
    .where(and(eq(notificationQueue.userId, userId), isNull(notificationQueue.sentAt)))
    .returning();
}

export const drizzleNotificationQueue: NotificationQueuePort = {
  async enqueue(userId, kind, payload) {
    await db.insert(notificationQueue).values({
      userId,
      kind,
      payload,
    });
  },

  async claimUnsent(userId, now) {
    const rows = await buildClaimUnsentStatement(userId, now);

    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      kind: row.kind,
      payload: row.payload,
      createdAt: row.createdAt,
    }));
  },
};
