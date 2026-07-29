import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { books, series } from "./catalog";
import { readStateValue } from "./enums";
import { users } from "./users";

export const tracks = pgTable(
  "tracks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seriesId: uuid("series_id").references(() => series.id, {
      onDelete: "cascade",
    }),
    bookId: uuid("book_id").references(() => books.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "track_target_xor",
      sql`(${t.seriesId} IS NULL) <> (${t.bookId} IS NULL)`,
    ),
    unique("track_unique_series").on(t.userId, t.seriesId),
    unique("track_unique_book").on(t.userId, t.bookId),
  ],
);

export const readStates = pgTable(
  "read_states",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    state: readStateValue("state").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.bookId] })],
);

export const notificationPrefs = pgTable("notification_prefs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  trackId: uuid("track_id").references(() => tracks.id, {
    onDelete: "cascade",
  }),
  channel: text("channel").notNull(),
  leadDays: integer("lead_days").notNull().default(7),
  enabled: boolean("enabled").notNull().default(true),
});
