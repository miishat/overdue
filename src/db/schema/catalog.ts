import {
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { seriesStatus } from "./enums";

export const authors = pgTable("authors", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  sortName: text("sort_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const series = pgTable("series", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  status: seriesStatus("status").notNull().default("ongoing"),
  plannedLength: integer("planned_length"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const books = pgTable("books", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  seriesId: uuid("series_id").references(() => series.id, {
    onDelete: "set null",
  }),
  seriesPosition: numeric("series_position", { precision: 6, scale: 2 }),
  isbn13: text("isbn13"),
  coverUrl: text("cover_url"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const bookAuthors = pgTable(
  "book_authors",
  {
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => authors.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.bookId, t.authorId] })],
);
