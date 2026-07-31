import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { notificationQueue, pushSubscriptions } from "./push";
import { users } from "./users";

describe("pushSubscriptions", () => {
  const config = getTableConfig(pushSubscriptions);
  const columnsByKey = Object.fromEntries(config.columns.map((c) => [c.name, c]));

  it("maps every column to its underlying SQL name", () => {
    const names = config.columns.map((c) => c.name);
    expect(names).toEqual([
      "id",
      "user_id",
      "endpoint",
      "p256dh",
      "auth",
      "user_agent",
      "created_at",
      "last_success_at",
      "last_failure_at",
      "failure_count",
    ]);
  });

  it("requires endpoint, p256dh, and auth", () => {
    expect(columnsByKey.endpoint?.notNull).toBe(true);
    expect(columnsByKey.p256dh?.notNull).toBe(true);
    expect(columnsByKey.auth?.notNull).toBe(true);
  });

  it("leaves the health columns nullable", () => {
    expect(columnsByKey.last_success_at?.notNull).toBe(false);
    expect(columnsByKey.last_failure_at?.notNull).toBe(false);
  });

  it("defaults failureCount to 0", () => {
    expect(columnsByKey.failure_count?.notNull).toBe(true);
    expect(columnsByKey.failure_count?.default).toBe(0);
  });

  it("prevents re-subscribing a device from duplicating rows", () => {
    const unique = config.uniqueConstraints.find(
      (u) => u.name === "push_subscription_endpoint_unique",
    );
    expect(unique).toBeDefined();
    expect(unique?.columns.map((c) => c.name)).toEqual(["endpoint"]);
  });

  it("indexes subscriptions by user", () => {
    const index = config.indexes.find((i) => i.config.name === "push_subscription_user_idx");
    expect(index).toBeDefined();
    expect(index?.config.columns.map((c) => (c as { name: string }).name)).toEqual(["user_id"]);
  });
});

describe("notificationQueue", () => {
  const config = getTableConfig(notificationQueue);
  const columnsByKey = Object.fromEntries(config.columns.map((c) => [c.name, c]));

  it("maps every column to its underlying SQL name", () => {
    const names = config.columns.map((c) => c.name);
    expect(names).toEqual(["id", "user_id", "kind", "payload", "created_at", "sent_at"]);
  });

  it("stores payload as jsonb", () => {
    expect(columnsByKey.payload?.columnType).toBe("PgJsonb");
    expect(columnsByKey.payload?.notNull).toBe(true);
  });

  it("indexes unsent notifications by user", () => {
    const index = config.indexes.find(
      (i) => i.config.name === "notification_queue_unsent_idx",
    );
    expect(index).toBeDefined();
    expect(index?.config.columns.map((c) => (c as { name: string }).name)).toEqual([
      "user_id",
      "sent_at",
    ]);
  });
});

describe("users", () => {
  it("records when the shelf was last viewed", () => {
    const config = getTableConfig(users);
    const column = config.columns.find((c) => c.name === "last_shelf_viewed_at");
    expect(column).toBeDefined();
    expect(column?.notNull).toBe(false);
  });
});
