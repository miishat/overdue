import { describe, expect, it } from "vitest";

// db/client.ts throws if DATABASE_URL is unset. seen.ts imports it for the
// live drizzleSeenStore even though changedBookIds itself is pure, so a
// placeholder here lets this file exercise the real changedBookIds without
// ever touching a real database.
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";

const { changedBookIds } = await import("./seen");

const BASELINE = new Date("2026-07-01T00:00:00Z");

describe("changedBookIds", () => {
  it("returns an empty set for a null baseline, even with rows present", () => {
    const result = changedBookIds({
      rows: [{ entityId: "b1", observedAt: new Date("2026-07-15T00:00:00Z") }],
      since: null,
    });
    expect(result).toEqual(new Set());
  });

  it("includes a row observed strictly after the baseline", () => {
    const result = changedBookIds({
      rows: [{ entityId: "b1", observedAt: new Date("2026-07-02T00:00:00Z") }],
      since: BASELINE,
    });
    expect(result).toEqual(new Set(["b1"]));
  });

  it("excludes a row observed strictly before the baseline", () => {
    const result = changedBookIds({
      rows: [{ entityId: "b1", observedAt: new Date("2026-06-30T00:00:00Z") }],
      since: BASELINE,
    });
    expect(result).toEqual(new Set());
  });

  it("excludes a row observed exactly at the baseline, since it was already visible last view", () => {
    const result = changedBookIds({
      rows: [{ entityId: "b1", observedAt: new Date(BASELINE) }],
      since: BASELINE,
    });
    expect(result).toEqual(new Set());
  });

  it("collapses several rows for one book to a single id", () => {
    const result = changedBookIds({
      rows: [
        { entityId: "b1", observedAt: new Date("2026-07-02T00:00:00Z") },
        { entityId: "b1", observedAt: new Date("2026-07-03T00:00:00Z") },
        { entityId: "b1", observedAt: new Date("2026-07-04T00:00:00Z") },
      ],
      since: BASELINE,
    });
    expect(result).toEqual(new Set(["b1"]));
    expect(result.size).toBe(1);
  });

  it("returns an empty set for an empty row list", () => {
    const result = changedBookIds({ rows: [], since: BASELINE });
    expect(result).toEqual(new Set());
  });
});
