import { getCurrentUserId } from "@/lib/current-user";
import { RELEASE_DATE_FIELD, diffSnapshots, type ChangeRow } from "./diff";
import { selectSlice, type Sliceable } from "./slice";
import type { BookSnapshot } from "./snapshot";

/**
 * Everything the run touches, injected.
 *
 * This is an interface rather than direct imports because M1 shipped a defect
 * (every discovered book persisting with a NULL series id) that its tests
 * missed precisely because they mocked the persistence function. Fakes at this
 * boundary keep the orchestration honestly testable.
 */
export interface RefreshPort {
  candidates(): Promise<Array<Sliceable & { seriesId: string | null }>>;
  currentSnapshot(bookId: string): Promise<BookSnapshot | null>;
  refetchSnapshot(bookId: string): Promise<BookSnapshot | null>;
  writeChanges(rows: ChangeRow[]): Promise<void>;
  markRefreshed(bookIds: string[], at: Date): Promise<void>;
  enqueue(userId: string, kind: string, payload: unknown): Promise<void>;
}

export interface RefreshResult {
  examined: number;
  changed: number;
  changeRows: number;
  failures: Array<{ bookId: string; reason: string }>;
}

export async function runRefresh(
  port: RefreshPort,
  now: Date,
  sliceSize?: number,
): Promise<RefreshResult> {
  const userId = await getCurrentUserId();
  const slice = selectSlice(await port.candidates(), now, sliceSize);

  const rows: ChangeRow[] = [];
  const succeeded: string[] = [];
  const failures: RefreshResult["failures"] = [];
  let changed = 0;

  for (const candidate of slice) {
    try {
      const before = await port.currentSnapshot(candidate.bookId);
      // No stored state means there is nothing to diff against. The book will
      // be picked up once it has been persisted.
      if (!before) continue;

      const after = await port.refetchSnapshot(candidate.bookId);
      // Providers no longer returning the book is not a change worth
      // recording. Deleting our copy on a provider outage would be worse than
      // keeping stale data, since Postgres owns the data.
      if (!after) {
        succeeded.push(candidate.bookId);
        continue;
      }

      const diff = diffSnapshots(before, after);
      if (diff.length > 0) {
        rows.push(...diff);
        changed += 1;

        // The date change is the signature alert and is delivered on its own
        // rather than waiting for the daily digest.
        const dateMove = diff.find((r) => r.field === RELEASE_DATE_FIELD);
        if (dateMove) {
          await port.enqueue(userId, "date_change", {
            bookId: candidate.bookId,
            from: dateMove.oldValue,
            to: dateMove.newValue,
            provider: dateMove.provider,
          });
        }
      }

      succeeded.push(candidate.bookId);
    } catch (error) {
      // One flaky provider must not stop every other book from refreshing.
      // The book is deliberately NOT marked refreshed, so it stays near the
      // front of the queue instead of rotating to the back.
      failures.push({
        bookId: candidate.bookId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (rows.length > 0) await port.writeChanges(rows);
  if (succeeded.length > 0) await port.markRefreshed(succeeded, now);

  return {
    examined: slice.length,
    changed,
    changeRows: rows.length,
    failures,
  };
}
