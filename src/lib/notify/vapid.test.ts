import { describe, expect, it } from "vitest";
import { isPushConfigured, readVapidConfig } from "./vapid";

// NODE_ENV is a required, readonly member of NodeJS.ProcessEnv (added by
// next/types/global.d.ts), so a mock env object needs a value for it to be
// a real ProcessEnv rather than a cast that papers over a missing field.
// vitest itself sets NODE_ENV=test while running, so "test" is honest here.
const COMPLETE: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  VAPID_PUBLIC_KEY: "test-public",
  VAPID_PRIVATE_KEY: "test-private",
  VAPID_SUBJECT: "mailto:someone@example.com",
};

const EMPTY: NodeJS.ProcessEnv = { NODE_ENV: "test" };

describe("readVapidConfig", () => {
  it("reads a complete configuration", () => {
    expect(readVapidConfig(COMPLETE)).toEqual({
      publicKey: "test-public",
      privateKey: "test-private",
      subject: "mailto:someone@example.com",
    });
  });

  it("returns null when any key is missing, rather than a partial config", () => {
    for (const missing of [
      "VAPID_PUBLIC_KEY",
      "VAPID_PRIVATE_KEY",
      "VAPID_SUBJECT",
    ]) {
      const env = { ...COMPLETE };
      delete env[missing];
      expect(readVapidConfig(env)).toBeNull();
    }
  });

  it("treats an empty or whitespace value as missing", () => {
    expect(readVapidConfig({ ...COMPLETE, VAPID_PUBLIC_KEY: "" })).toBeNull();
    expect(readVapidConfig({ ...COMPLETE, VAPID_PRIVATE_KEY: "   " })).toBeNull();
  });

  it("rejects a subject that is not a mailto or https URL", () => {
    expect(
      readVapidConfig({ ...COMPLETE, VAPID_SUBJECT: "someone@example.com" }),
    ).toBeNull();
  });

  it("accepts an https subject", () => {
    expect(
      readVapidConfig({ ...COMPLETE, VAPID_SUBJECT: "https://example.com" }),
    ).not.toBeNull();
  });
});

describe("isPushConfigured", () => {
  it("is true only for a complete configuration", () => {
    expect(isPushConfigured(COMPLETE)).toBe(true);
    expect(isPushConfigured(EMPTY)).toBe(false);
  });
});
