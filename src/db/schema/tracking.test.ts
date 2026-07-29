import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { tracks } from "./tracking";

describe("tracks table", () => {
  it("has nullable series_id and book_id", () => {
    const config = getTableConfig(tracks);
    const names = config.columns.map((c) => c.name);
    expect(names).toContain("series_id");
    expect(names).toContain("book_id");
    const seriesCol = config.columns.find((c) => c.name === "series_id");
    expect(seriesCol?.notNull).toBe(false);
  });

  it("declares a check constraint enforcing exactly one target", () => {
    const config = getTableConfig(tracks);
    expect(config.checks.map((c) => c.name)).toContain("track_target_xor");
  });
});
