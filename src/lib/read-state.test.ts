import { describe, expect, it } from "vitest";
import type { ReadStateStore } from "./read-state";

// db/client.ts throws if DATABASE_URL is unset. neon() only builds a lazy
// query function at construction time and does not connect, so setting a
// placeholder here lets the pure-helper tests import read-state.ts without
// ever touching a real database. The import itself must be dynamic so this
// assignment runs before the module (and its db/client dependency) loads.
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";

describe("isReadStateValue", () => {
  it("accepts every value in the enum", async () => {
    const { isReadStateValue } = await import("./read-state");
    for (const value of ["want", "reading", "read", "skipped"]) {
      expect(isReadStateValue(value)).toBe(true);
    }
  });

  it("rejects an unknown string", async () => {
    const { isReadStateValue } = await import("./read-state");
    expect(isReadStateValue("finished")).toBe(false);
  });

  it("rejects non-strings without throwing", async () => {
    const { isReadStateValue } = await import("./read-state");
    expect(isReadStateValue(null)).toBe(false);
    expect(isReadStateValue(undefined)).toBe(false);
    expect(isReadStateValue(3)).toBe(false);
    expect(isReadStateValue({})).toBe(false);
  });
});

describe("readStatesFor", () => {
  it("returns an empty map without querying when given no ids", async () => {
    const { readStatesFor } = await import("./read-state");
    let called = false;
    const store: ReadStateStore = {
      async get() {
        called = true;
        return new Map();
      },
      async set() {},
    };

    const result = await readStatesFor([], store);

    expect(result.size).toBe(0);
    expect(called).toBe(false);
  });

  it("passes the ids through and returns what the store gives", async () => {
    const { readStatesFor } = await import("./read-state");
    const store: ReadStateStore = {
      async get(_userId, bookIds) {
        expect(bookIds).toEqual(["b1", "b2"]);
        return new Map([["b1", "read" as const]]);
      },
      async set() {},
    };

    const result = await readStatesFor(["b1", "b2"], store);

    expect(result.get("b1")).toBe("read");
    expect(result.get("b2")).toBeUndefined();
  });
});
