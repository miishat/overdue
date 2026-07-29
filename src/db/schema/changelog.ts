import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { providerName } from "./enums";

export const changeLog = pgTable(
  "change_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    field: text("field").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    provider: providerName("provider"),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("changelog_entity_idx").on(t.entityType, t.entityId)],
);
