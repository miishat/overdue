import type { DatePrecision, ProviderName } from "@/db/schema/enums";
import { getCurrentUserId } from "@/lib/current-user";
import { RELEASE_DATE_FIELD, diffSnapshots, type ChangeRow } from "./diff";
import { selectSlice, type Sliceable } from "./slice";
import type { BookSnapshot } from "./snapshot";

/**
 * The exact shape enqueued under kind "date_change", shared with
 * src/lib/notify/drain.ts so the writer and the reader cannot drift. drain.ts
 * imports this type (type-only, no runtime dependency) and validates
 * incoming queue rows against it, so a field added or renamed here shows up
 * as a type error in drain.ts rather than as a payload silently rejected or
 * misread at drain time.
 *
 * `provider` mirrors ChangeRow.provider (src/lib/refresh/diff.ts): it is
 * `ProviderName | null`, never plain `undefined`, because diffSnapshots
 * always sets it from `after.sourceProvider`, which is `null` (not absent)
 * whenever the book has no release row or a release with no sources. The
 * withdrawal case (`to: null`) is exactly when this is null: the release row
 * is gone, so there is no provider to report.
 */
export interface DateChangeQueuePayload {
  bookId: string;
  bookTitle: string;
  from: string | null;
  to: string | null;
  fromPrecision?: DatePrecision | null;
  toPrecision?: DatePrecision | null;
  provider: ProviderName | null;
}

/**
 * Everything the run touches, injected.
 *
 * This is an interface rather than direct imports because M1 shipped a defect
 * (every discovered book persisting with a NULL series id) that its tests
 * missed precisely because they mocked the persistence function. Fakes at this
 * boundary keep the orchestration honestly testable.
 */
/**
 * What one read-only re-fetch produced.
 *
 * `resolution` is deliberately `unknown` to runRefresh: it is the port's own
 * handle on whatever it needs to perform the deferred write-back, handed back
 * to commitRefetched untouched. Carrying it through the return value rather
 * than stashing it in module-level state in the port is what makes the port
 * reentrant: two overlapping runs cannot clobber each other's pending
 * resolutions, and nothing survives the run that created it.
 */
export interface RefetchedBook {
  /** What the stored snapshot is PREDICTED to become once committed. */
  snapshot: BookSnapshot;
  resolution: unknown;
}

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
  refetchSnapshot(bookId: string, now: Date): Promise<RefetchedBook | null>;
  writeChanges(rows: ChangeRow[]): Promise<void>;
  /**
   * The deferred half of refetchSnapshot: commit the resolution refetchSnapshot
   * produced for this book to books/releases/release_sources. Called only after
   * writeChanges has durably recorded the history for the whole run.
   *
   * MUST return the ACTUAL post-commit snapshot, read back from the database
   * exactly the way currentSnapshot reads it. runRefresh diffs it against the
   * prediction so that any divergence between what was predicted and what was
   * really written is recorded rather than silently lost. See phase 5.
   *
   * MUST throw rather than return quietly if there is no resolution to commit.
   * A port that reports success for a commit it did not perform would let
   * runRefresh mark the book refreshed on the strength of a write that never
   * happened.
   *
   * DELIBERATE TRADE: if this step fails, the next run re-fetches, recomputes
   * the same diff, and writes a DUPLICATE change_log row. That is the correct
   * direction to fail in. A duplicate history row is recoverable by a reader;
   * a missing one is not.
   */
  commitRefetched(
    bookId: string,
    resolution: unknown,
    now: Date,
  ): Promise<BookSnapshot>;
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

  /**
   * The resolutions this run is holding between the read phase and the
   * write-back phase, scoped to this call. Module-level state here would make
   * the port non-reentrant (two overlapping runs would delete each other's
   * entries) and leaky (a throw from writeChanges would strand every entry for
   * the slice on a warm serverless instance).
   */
  const refetched = new Map<string, RefetchedBook>();

  const fail = (bookId: string, error: unknown) => {
    failedIds.add(bookId);
    failures.push({ bookId, reason: reasonOf(error) });
    // The HTTP response reports only a COUNT of failures, deliberately, so a
    // book that fails forever would otherwise be undiagnosable. This is the
    // only place the per-book reason is surfaced. Reasons come from provider
    // and data-integrity errors, never from the request or CRON_SECRET.
    console.error(`refresh: book ${bookId} failed: ${reasonOf(error)}`);
  };

  // Phase 1: read and diff only. Nothing is written to the database, and no
  // alert is delivered, until the whole slice has been examined.
  for (const candidate of slice) {
    try {
      const before = await port.currentSnapshot(candidate.bookId, now);
      // No stored state means there is nothing to diff against. The book will
      // be picked up once it has been persisted.
      if (!before) continue;

      const refetch = await port.refetchSnapshot(candidate.bookId, now);
      // Providers no longer returning the book is not a change worth
      // recording. Deleting our copy on a provider outage would be worse than
      // keeping stale data, since Postgres owns the data.
      if (!refetch) {
        succeeded.push(candidate.bookId);
        continue;
      }

      refetched.set(candidate.bookId, refetch);
      const after = refetch.snapshot;

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
          const payload: DateChangeQueuePayload = {
            bookId: candidate.bookId,
            bookTitle: after.title,
            from: dateMove.oldValue,
            to: dateMove.newValue,
            fromPrecision: dateMove.oldValue === null ? null : before.datePrecision,
            toPrecision: dateMove.newValue === null ? null : after.datePrecision,
            provider: dateMove.provider,
          };
          pendingAlerts.push({
            bookId: candidate.bookId,
            payload,
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
  const corrections: ChangeRow[] = [];
  for (const bookId of succeeded) {
    if (failedIds.has(bookId)) continue;
    const pending = refetched.get(bookId);
    // Nothing was resolved for this book (the providers no longer return it),
    // so there is nothing to write back. The port is never asked to commit
    // without a resolution, and it treats being asked as a hard error.
    if (!pending) {
      committed.push(bookId);
      continue;
    }
    try {
      const actual = await port.commitRefetched(bookId, pending.resolution, now);
      // The predicted snapshot phase 1 diffed is a MIRROR of the write rules,
      // not the write itself, so it can be wrong. If it is, the difference
      // between the prediction and what was really written is a real change to
      // a stored value that no change_log row covers, and because the next run
      // reads the committed value back as its "before" and predicts it again,
      // the row would never be written by any later run either: permanently
      // lost, in an append-only table. Diffing the actual committed snapshot
      // against the prediction closes that for every field at once instead of
      // relying on the mirror staying correct forever. A right prediction
      // yields no rows and costs nothing.
      corrections.push(...diffSnapshots(pending.snapshot, actual));
      committed.push(bookId);
    } catch (error) {
      fail(bookId, error);
    }
  }

  // Phase 5: the correcting history.
  //
  // This has to sit AFTER phase 4, for the same reason phase 4 sits after
  // phase 2: it records values that only exist because the commit produced
  // them, so it cannot be written before that commit. And it has to sit BEFORE
  // markRefreshed, so that a failure here leaves every book unmarked and near
  // the front of the queue rather than rotated away with a change unrecorded.
  // A throw propagates, exactly like phase 2's, and markRefreshed never runs.
  //
  // No date_change alert is re-sent from here. Alerts are delivered in phase 3
  // strictly before anything is made unobservable, and a correction row means
  // the prediction was wrong rather than that a provider moved a date, so the
  // history is the right place for it and a notification is not.
  if (corrections.length > 0) {
    await port.writeChanges(corrections);
    rows.push(...corrections);
  }

  // Phase 6: rotate the committed books to the back of the queue.
  if (committed.length > 0) await port.markRefreshed(committed, now);

  return {
    examined: slice.length,
    changed,
    changeRows: rows.length,
    failures,
  };
}
