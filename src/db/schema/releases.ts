import {
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { books } from "./catalog";
import { datePrecision, providerName, releaseStatus } from "./enums";

export const releases = pgTable(
  "releases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    region: text("region").notNull().default("US"),
    format: text("format").notNull().default("hardcover"),
    date: date("date"),
    datePrecision: datePrecision("date_precision"),
    status: releaseStatus("status").notNull(),
    confidence: integer("confidence").notNull().default(50),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("release_book_idx").on(t.bookId),
    index("release_date_idx").on(t.date),
    // One row per (book, region, format): re-persisting the same book
    // refreshes what we believe about that release instead of appending
    // another row for it. See persistResolvedBook's onConflictDoUpdate.
    unique("release_book_region_format_unique").on(t.bookId, t.region, t.format),
  ],
);

export const releaseSources = pgTable("release_sources", {
  id: uuid("id").defaultRandom().primaryKey(),
  releaseId: uuid("release_id")
    .notNull()
    .references(() => releases.id, { onDelete: "cascade" }),
  provider: providerName("provider").notNull(),
  sourceUrl: text("source_url"),
  valueSeen: text("value_seen"),
  trustRank: integer("trust_rank").notNull().default(0),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
