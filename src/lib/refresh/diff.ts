import type { ProviderName } from "@/db/schema/enums";
import { snapshotFields, type BookSnapshot } from "./snapshot";

/**
 * The exact string src/lib/changes.ts filters on when building Book detail's
 * date history. Reader and writer share this constant so they cannot drift:
 * if they disagreed, the history would stay silently empty and no test would
 * fail, because the two sides are tested separately.
 */
export const RELEASE_DATE_FIELD = "release_date";

/**
 * Snapshot fields are camelCase; change_log.field is snake_case. This is the
 * only place that mapping lives.
 */
export const CHANGE_FIELDS: Record<string, string> = {
  title: "title",
  seriesId: "series_id",
  seriesPosition: "series_position",
  coverUrl: "cover_url",
  releaseDate: RELEASE_DATE_FIELD,
  datePrecision: "date_precision",
  status: "status",
};

export interface ChangeRow {
  entityType: "book";
  entityId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  provider: ProviderName | null;
}

/** change_log stores text, so every value is serialised on the way in. */
function serialise(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

export function diffSnapshots(
  before: BookSnapshot,
  after: BookSnapshot,
): ChangeRow[] {
  const rows: ChangeRow[] = [];

  for (const field of snapshotFields()) {
    if (before[field] === after[field]) continue;

    const stored = CHANGE_FIELDS[field];
    if (!stored) continue;

    rows.push({
      entityType: "book",
      entityId: after.bookId,
      field: stored,
      oldValue: serialise(before[field]),
      newValue: serialise(after[field]),
      // The provider that supplied the new value, so the history can show
      // which source moved the date.
      provider: after.sourceProvider,
    });
  }

  return rows;
}
