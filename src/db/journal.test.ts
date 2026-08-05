import { existsSync, readdirSync } from "node:fs";
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

  // The check above only proves every journal tag has a file. It says
  // nothing about a file that has no journal entry: drizzle-kit has
  // silently skipped a migration before because it trusts the journal, not
  // a directory scan, to know which migrations exist. A trailing entry can
  // be removed from the journal while its .sql file stays on disk, and the
  // three checks above stay green because they only ever walk forward from
  // the journal. This check walks the other direction: from disk to journal.
  it("has a journal entry for every .sql file on disk", () => {
    const filesOnDisk = readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => name.replace(/\.sql$/, ""))
      .sort();
    const tagsInJournal = entries.map((e) => e.tag).sort();
    expect(filesOnDisk).toEqual(tagsInJournal);
  });
});
