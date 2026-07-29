import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { providerName } from "./enums";

export const externalIds = pgTable(
  "external_ids",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    provider: providerName("provider").notNull(),
    externalId: text("external_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("external_id_unique").on(t.provider, t.externalId, t.entityType),
    index("external_id_entity_idx").on(t.entityType, t.entityId),
  ],
);

export const providerRecords = pgTable(
  "provider_records",
  {
    provider: providerName("provider").notNull(),
    externalId: text("external_id").notNull(),
    payload: jsonb("payload").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("provider_record_pk").on(t.provider, t.externalId)],
);
