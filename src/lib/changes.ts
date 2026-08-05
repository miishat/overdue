import type { ProviderName } from "@/db/schema/enums";
import { RELEASE_DATE_FIELD } from "@/lib/refresh/diff";

/**
 * Shape of a change_log row, matched by hand rather than inferred from the
 * Drizzle table, mirroring TrackedBookRow's style in src/lib/shelf.ts.
 */
export interface ChangeLogRow {
  id: string;
  entityType: string;
  entityId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  provider: ProviderName | null;
  observedAt: Date;
}

export interface DateChange {
  from: Date;
  to: Date;
  provider: ProviderName;
  observedAt: Date;
}

function parseDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Filters change_log rows down to release-date moves and parses their dates.
 *
 * change_log has been accumulating rows since M1 with nothing reading them,
 * so a historical row can be malformed in ways nothing ever caught. A row
 * that fails to parse is skipped rather than thrown, so one bad row from
 * months ago cannot blank a book's entire history.
 */
export function dateChangesFrom(rows: ChangeLogRow[]): DateChange[] {
  const changes: DateChange[] = [];

  for (const row of rows) {
    if (row.field !== RELEASE_DATE_FIELD) continue;
    // A null old_value is a first-ever date being recorded, not a move.
    if (row.oldValue === null) continue;
    if (row.newValue === null) continue;
    // A stamp names its source, so a change with no provider has nothing
    // honest to attribute it to and is dropped rather than shown unsourced.
    if (row.provider === null) continue;

    const from = parseDate(row.oldValue);
    const to = parseDate(row.newValue);
    if (from === null || to === null) continue;

    // change_log's string formats are unconstrained, so the same instant can
    // be written two different ways (a bare date vs. a full timestamp). That
    // is a formatting difference, not a move, and formatMove would render it
    // as "MOVED +0D" in oxide, the token reserved for a date that actually
    // slipped later. Skip it here rather than asking formatMove to guess.
    if (from.getTime() === to.getTime()) continue;

    changes.push({
      from,
      to,
      provider: row.provider,
      observedAt: row.observedAt,
    });
  }

  return changes.sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());
}
