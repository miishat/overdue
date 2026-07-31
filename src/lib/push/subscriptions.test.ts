import { describe, expect, it, beforeAll } from "vitest";

// db/client.ts throws if DATABASE_URL is unset at import time. neon() only
// builds a lazy query function at construction time and does not connect,
// so a placeholder here lets a dynamic import load the real
// isSubscriptionInput without ever touching a real database. The import must
// be dynamic (deferred past this assignment) because a static import would
// be hoisted above it.
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";

let isSubscriptionInput: typeof import("./subscriptions").isSubscriptionInput;

beforeAll(async () => {
  ({ isSubscriptionInput } = await import("./subscriptions"));
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

  it("rejects a numeric userAgent", () => {
    expect(isSubscriptionInput({ ...valid, userAgent: 123 })).toBe(false);
  });

  it("rejects a missing endpoint", () => {
    const { endpoint: _endpoint, ...rest } = valid;
    expect(isSubscriptionInput(rest)).toBe(false);
  });

  it("rejects a missing p256dh", () => {
    const { p256dh: _p256dh, ...rest } = valid;
    expect(isSubscriptionInput(rest)).toBe(false);
  });

  it("rejects a missing auth", () => {
    const { auth: _auth, ...rest } = valid;
    expect(isSubscriptionInput(rest)).toBe(false);
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
