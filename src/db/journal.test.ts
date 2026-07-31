import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import journal from "../../drizzle/meta/_journal.json";

// Two historical incidents motivate this test: once a journal entry was
// missing entirely, once its timestamp was lower than the previous entry's.
// Both times drizzle-kit silently skipped a migration while reporting
// success, because it relies on the journal, not a directory scan, to know
// which migrations exist and in what order. This test makes both classes of
// corruption fail loudly instead of silently.

const migrationsDir = path.resolve(__dirname, "../../drizzle");

describe("migration journal", () => {
  const entries = journal.entries;

  it("has strictly increasing when values across entries", () => {
    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1];
      const curr = entries[i];
      expect(curr.when).toBeGreaterThan(prev.when);
    }
  });

  it("has contiguous idx values starting from 0", () => {
    const indexes = entries.map((e) => e.idx);
    expect(indexes).toEqual(entries.map((_, i) => i));
  });

  it("resolves every tag to an actual .sql file on disk", () => {
    for (const entry of entries) {
      const sqlPath = path.join(migrationsDir, `${entry.tag}.sql`);
      expect(existsSync(sqlPath), `missing migration file for tag "${entry.tag}"`).toBe(true);
    }
  });
});
