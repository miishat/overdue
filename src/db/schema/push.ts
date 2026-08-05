import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * One row per browser or installed PWA that granted notification permission.
 *
 * The health columns exist because iOS drops push subscriptions silently when
 * the user deletes and re-adds the home screen icon. Without them a dead
 * subscription is invisible, and since v1 has no email there is no second
 * channel to notice. Settings reads these.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    failureCount: integer("failure_count").notNull().default(0),
  },
  (t) => [
    // The endpoint is the browser's own identifier for this subscription, so
    // re-subscribing the same device must update rather than duplicate.
    unique("push_subscription_endpoint_unique").on(t.endpoint),
    index("push_subscription_user_idx").on(t.userId),
  ],
);

/**
 * Notifications are enqueued by the refresh job and sent separately.
 *
 * Enqueueing rather than sending inline means a slow provider cannot delay
 * delivery, a failed send can be retried without re-running the refresh, and
 * the daily digest can batch a run's worth of changes into one message
 * instead of several landing at once.
 */
export const notificationQueue = pgTable(
  "notification_queue",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // "digest" or "date_change". Kept as text rather than an enum so adding a
    // kind later needs no migration.
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("notification_queue_unsent_idx").on(t.userId, t.sentAt)],
);
