import { describe, expect, it } from "vitest";
import { dateChangesFrom, type ChangeLogRow } from "./changes";

function row(overrides: Partial<ChangeLogRow> = {}): ChangeLogRow {
  return {
    id: "row-1",
    entityType: "book",
    entityId: "book-1",
    field: "release_date",
    oldValue: "2026-09-01",
    newValue: "2026-10-01",
    provider: "wikidata",
    observedAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
}

describe("dateChangesFrom", () => {
  it("produces one DateChange for a release-date change row", () => {
    const result = dateChangesFrom([row()]);
    expect(result).toEqual([
      {
        from: new Date("2026-09-01"),
        to: new Date("2026-10-01"),
        provider: "wikidata",
        observedAt: new Date("2026-07-01T00:00:00Z"),
      },
    ]);
  });

  it("excludes rows for fields other than release_date", () => {
    const result = dateChangesFrom([row({ field: "title" })]);
    expect(result).toEqual([]);
  });

  it("skips a row whose old_value does not parse as a date, rather than throwing", () => {
    expect(() =>
      dateChangesFrom([row({ oldValue: "not-a-date" })]),
    ).not.toThrow();
    expect(dateChangesFrom([row({ oldValue: "not-a-date" })])).toEqual([]);
  });

  it("skips a row whose new_value does not parse as a date", () => {
    expect(dateChangesFrom([row({ newValue: "also-not-a-date" })])).toEqual(
      [],
    );
  });

  it("does not let one malformed historical row blank the rest of the history", () => {
    const good = row({ id: "row-good" });
    const bad = row({ id: "row-bad", oldValue: "garbage" });
    const result = dateChangesFrom([bad, good]);
    expect(result).toHaveLength(1);
    expect(result[0]?.provider).toBe("wikidata");
  });

  it("excludes a row with a null old_value, since that is a first-ever date, not a move", () => {
    const result = dateChangesFrom([row({ oldValue: null })]);
    expect(result).toEqual([]);
  });

  it("orders results most recent first", () => {
    const earlier = row({
      id: "row-earlier",
      observedAt: new Date("2026-06-01T00:00:00Z"),
    });
    const later = row({
      id: "row-later",
      observedAt: new Date("2026-07-15T00:00:00Z"),
    });
    const result = dateChangesFrom([earlier, later]);
    expect(result.map((c) => c.observedAt)).toEqual([
      later.observedAt,
      earlier.observedAt,
    ]);
  });
});
