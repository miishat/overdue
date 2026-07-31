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
  /**
   * `now` is passed in rather than read from the clock inside the port so that
   * currentSnapshot and refetchSnapshot derive status from ONE instant. Two
   * independent `new Date()` calls straddling a release instant would turn
   * identical data into a spurious `status` change row.
   */
  currentSnapshot(bookId: string, now: Date): Promise<BookSnapshot | null>;
  /**
   * Re-fetch the book from its providers and return what the stored snapshot
   * WOULD become. This method MUST NOT write anything.
   *
   * WHY THE WRITE IS NOT DONE HERE, and must never be folded back in:
   * change_log is append-only history, and it is only ever written by
   * runRefresh after the whole slice has been diffed. If refetchSnapshot
   * persisted the new values as it went, then a throw from writeChanges, or a
   * crash or platform timeout part way through the loop, would leave the new
   * values already committed to books/releases while no change_log row was
   * ever written for the move. The next run's currentSnapshot would read those
   * committed values back, refetchSnapshot would return the same values, the
   * diff would be empty, and the change would be PERMANENTLY LOST: Book
   * detail's history would silently miss it forever. So the run makes a change
   * observable before it makes it unobservable.
   */
  refetchSnapshot(bookId: string, now: Date): Promise<BookSnapshot | null>;
  writeChanges(rows: ChangeRow[]): Promise<void>;
  /**
   * The deferred half of refetchSnapshot: commit the snapshot that was
   * resolved for this book to books/releases/release_sources. Called only
   * after writeChanges has durably recorded the history for the whole run.
   *
   * DELIBERATE TRADE: if this step fails, the next run re-fetches, recomputes
   * the same diff, and writes a DUPLICATE change_log row. That is the correct
   * direction to fail in. A duplicate history row is recoverable by a reader;
   * a missing one is not.
   *
   * A no-op for a book that had nothing to commit (a book the providers no
   * longer return).
   */
  commitRefetched(bookId: string): Promise<void>;
  markRefreshed(bookIds: string[], at: Date): Promise<void>;
  enqueue(userId: string, kind: string, payload: unknown): Promise<void>;
}

export interface RefreshResult {
  examined: number;
  changed: number;
  changeRows: number;
  failures: Array<{ bookId: string; reason: string }>;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  const failedIds = new Set<string>();
  const pendingAlerts: Array<{ bookId: string; payload: unknown }> = [];
  const failures: RefreshResult["failures"] = [];
  let changed = 0;

  const fail = (bookId: string, error: unknown) => {
    failedIds.add(bookId);
    failures.push({ bookId, reason: reasonOf(error) });
  };

  // Phase 1: read and diff only. Nothing is written to the database, and no
  // alert is delivered, until the whole slice has been examined.
  for (const candidate of slice) {
    try {
      const before = await port.currentSnapshot(candidate.bookId, now);
      // No stored state means there is nothing to diff against. The book will
      // be picked up once it has been persisted.
      if (!before) continue;

      const after = await port.refetchSnapshot(candidate.bookId, now);
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
        // rather than waiting for the daily digest. It is queued here and sent
        // later, so that no user can be told about a change whose history row
        // has not been written yet.
        const dateMove = diff.find((r) => r.field === RELEASE_DATE_FIELD);
        if (dateMove) {
          pendingAlerts.push({
            bookId: candidate.bookId,
            payload: {
              bookId: candidate.bookId,
              from: dateMove.oldValue,
              to: dateMove.newValue,
              provider: dateMove.provider,
            },
          });
        }
      }

      succeeded.push(candidate.bookId);
    } catch (error) {
      // One flaky provider must not stop every other book from refreshing.
      // The book is deliberately NOT marked refreshed, so it stays near the
      // front of the queue instead of rotating to the back.
      fail(candidate.bookId, error);
    }
  }

  // Phase 2: history first. If this throws, nothing downstream has run, so
  // the stored data is untouched and the next run recomputes the same diff.
  if (rows.length > 0) await port.writeChanges(rows);

  // Phase 3: alerts, now that the history backing them exists.
  for (const alert of pendingAlerts) {
    try {
      await port.enqueue(userId, "date_change", alert.payload);
    } catch (error) {
      fail(alert.bookId, error);
    }
  }

  // Phase 4: only now make the old values unobservable.
  const committed: string[] = [];
  for (const bookId of succeeded) {
    if (failedIds.has(bookId)) continue;
    try {
      await port.commitRefetched(bookId);
      committed.push(bookId);
    } catch (error) {
      fail(bookId, error);
    }
  }

  // Phase 5: rotate the committed books to the back of the queue.
  if (committed.length > 0) await port.markRefreshed(committed, now);

  return {
    examined: slice.length,
    changed,
    changeRows: rows.length,
    failures,
  };
}
