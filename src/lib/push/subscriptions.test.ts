import { describe, expect, it, beforeAll } from "vitest";

// db/client.ts throws if DATABASE_URL is unset at import time. neon() only
// builds a lazy query function at construction time and does not connect,
// so a placeholder here lets a dynamic import load the real
// isSubscriptionInput without ever touching a real database. The import must
// be dynamic (deferred past this assignment) because a static import would
// be hoisted above it.
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";

let isSubscriptionInput: typeof import("./subscriptions").isSubscriptionInput;
let buildUpsertStatement: typeof import("./subscriptions").buildUpsertStatement;
let buildRecordSuccessStatement: typeof import("./subscriptions").buildRecordSuccessStatement;

beforeAll(async () => {
  ({ isSubscriptionInput, buildUpsertStatement, buildRecordSuccessStatement } = await import(
    "./subscriptions"
  ));
});

const valid = {
  endpoint: "https://push.example.com/abc",
  p256dh: "key-p256dh",
  auth: "key-auth",
  userAgent: "Mozilla/5.0",
};

describe("isSubscriptionInput", () => {
  it("accepts a well-formed object", () => {
    expect(isSubscriptionInput(valid)).toBe(true);
  });

  it("accepts a null userAgent", () => {
    expect(isSubscriptionInput({ ...valid, userAgent: null })).toBe(true);
  });

  it("accepts an omitted userAgent and normalises it to null", () => {
    const candidate: Record<string, unknown> = {
      endpoint: valid.endpoint,
      p256dh: valid.p256dh,
      auth: valid.auth,
    };
    expect(isSubscriptionInput(candidate)).toBe(true);
    expect(candidate.userAgent).toBeNull();
  });

  it("rejects a numeric userAgent", () => {
    expect(isSubscriptionInput({ ...valid, userAgent: 123 })).toBe(false);
  });

  it("rejects a missing endpoint", () => {
    const rest = { p256dh: valid.p256dh, auth: valid.auth, userAgent: valid.userAgent };
    expect(isSubscriptionInput(rest)).toBe(false);
  });

  it("rejects a missing p256dh", () => {
    const rest = { endpoint: valid.endpoint, auth: valid.auth, userAgent: valid.userAgent };
    expect(isSubscriptionInput(rest)).toBe(false);
  });

  it("rejects a missing auth", () => {
    const rest = { endpoint: valid.endpoint, p256dh: valid.p256dh, userAgent: valid.userAgent };
    expect(isSubscriptionInput(rest)).toBe(false);
  });

  it("rejects an empty-string endpoint", () => {
    expect(isSubscriptionInput({ ...valid, endpoint: "" })).toBe(false);
  });

  it("rejects a non-string field", () => {
    expect(isSubscriptionInput({ ...valid, endpoint: 42 })).toBe(false);
  });

  it("rejects null without throwing", () => {
    expect(() => isSubscriptionInput(null)).not.toThrow();
    expect(isSubscriptionInput(null)).toBe(false);
  });

  it("rejects a non-object without throwing", () => {
    expect(() => isSubscriptionInput("not an object")).not.toThrow();
    expect(isSubscriptionInput("not an object")).toBe(false);
    expect(isSubscriptionInput(42)).toBe(false);
    expect(isSubscriptionInput(undefined)).toBe(false);
  });
});

// These assert on the SQL that drizzleSubscriptionStore.upsert actually
// issues, built through the same buildUpsertStatement the store calls, via
// drizzle's `.toSQL()`. Nothing here connects to a database: `.toSQL()`
// compiles the statement without executing it. That is what closes the
// coverage gap the review flagged: the route tests replace the whole store
// with a fake, so no line of the real Drizzle upsert ever ran under test,
// and a reviewer-mutated conflict clause (dropping the failureCount and
// lastFailureAt resets, or repointing the conflict target at the wrong
// column) passed the full suite anyway. Values below are obvious sentinels,
// not realistic-looking keys, so nothing here could be mistaken for a real
// secret if it ever showed up in test output.
describe("drizzleSubscriptionStore upsert statement", () => {
  const userId = "11111111-1111-1111-1111-111111111111";
  const input = {
    endpoint: "https://push.example.com/sql-check",
    p256dh: "SENTINEL_P256DH",
    auth: "SENTINEL_AUTH",
    userAgent: null,
  };

  it("targets the endpoint unique constraint for the conflict clause", () => {
    const { sql } = buildUpsertStatement(userId, input).toSQL();

    // The real constraint is push_subscription_endpoint_unique, defined in
    // src/db/schema/push.ts as unique(...).on(t.endpoint). Drizzle compiles
    // a single-column target to the column name itself.
    expect(sql).toMatch(/on conflict \("endpoint"\) do update/i);
  });

  it("resets failure health (failureCount to 0, lastFailureAt to null) on conflict", () => {
    const { sql, params } = buildUpsertStatement(userId, input).toSQL();

    expect(sql).toMatch(/"failure_count" = \$\d+/);
    expect(sql).toMatch(/"last_failure_at" = \$\d+/);

    // The reviewer's mutation removed these two assignments entirely, which
    // a substring check on the SQL text alone already catches. This also
    // confirms the bound values are the reset values, not carried-over
    // input, so a mutation that keeps the assignment but binds the wrong
    // value would fail too.
    expect(params).toContain(0);
    expect(params.filter((p) => p === null).length).toBeGreaterThanOrEqual(2);
  });

  it("does not target the userId column for the conflict clause", () => {
    const { sql } = buildUpsertStatement(userId, input).toSQL();

    expect(sql).not.toMatch(/on conflict \("user_id"\)/i);
  });
});

// Binds to the statement drizzleSubscriptionStore.recordSuccess actually
// runs, via buildRecordSuccessStatement, the same way the upsert tests above
// bind to buildUpsertStatement. A device that recovers must stop showing as
// unhealthy in Settings, so a success has to reset failureCount to zero, not
// just record lastSuccessAt. A test that only asserts recordSuccess was
// called (as send.test.ts's prior "resets failureCount" test did) cannot
// fail if the reset is missing, since the store, not the caller, is what is
// supposed to perform it; asserting on the compiled SQL is what closes that
// gap.
describe("drizzleSubscriptionStore recordSuccess statement", () => {
  const id = "33333333-3333-3333-3333-333333333333";
  const at = new Date("2026-07-31T00:00:00Z");

  it("sets lastSuccessAt to the given time", () => {
    const { sql, params } = buildRecordSuccessStatement(id, at).toSQL();

    expect(sql).toMatch(/set\s+.*"last_success_at" = \$\d+/i);
    expect(params).toContainEqual(at.toISOString());
  });

  it("resets failureCount to zero in the same statement", () => {
    const { sql, params } = buildRecordSuccessStatement(id, at).toSQL();

    expect(sql).toMatch(/"failure_count" = \$\d+/);
    expect(params).toContain(0);
  });

  it("scopes the update to the given subscription id", () => {
    const { sql, params } = buildRecordSuccessStatement(id, at).toSQL();

    const idParamIndex = sql.match(/"id"\s*=\s*\$(\d+)/i)?.[1];
    expect(idParamIndex).toBeDefined();
    expect(params[Number(idParamIndex) - 1]).toBe(id);
  });
});
