import type { SeriesRef } from "@/providers/registry";
import type { ResolvedBook } from "@/resolution/resolve";
import { selectDiscoverySlice, type DiscoverySliceable } from "./discovery-slice";

/**
 * One tracked series worth discovering, and what discoverSeriesEntries needs
 * to do it: the provider refs recorded for the series in external_ids
 * (entity_type = 'series'), restricted to hardcover and wikidata by the port
 * that builds this list (see discovery-port.ts) because those are the only
 * two adapters that implement getSeriesEntries at all; open-library and
 * google-books have no series endpoint and would only ever return an empty
 * result for it, exactly as src/app/api/track/route.ts's track-time
 * discovery already restricts to.
 */
export interface DiscoveryCandidate extends DiscoverySliceable {
  refs: SeriesRef[];
}

/**
 * Everything one discovery run touches, injected. Mirrors RefreshPort
 * (run.ts): a fake at this boundary is what makes the orchestration
 * testable without a database, and keeps a series whose provider is down
 * from being conflated with an orchestration bug.
 *
 * Unlike RefreshPort, there is no read/write split here. RefreshPort's
 * refetchSnapshot-then-commitRefetched split exists so that change_log (an
 * append-only history table) is never written after the row it describes has
 * already been made unobservable by a commit. Series discovery writes no
 * change_log rows at all (a newly discovered book is a NEW row, not a change
 * to an existing one, per the spec), and persistResolvedBook is already
 * idempotent via its external_ids dedup, so persisting eagerly here carries
 * none of the risk that split protects against. A partial persist that is
 * interrupted by a later failure just gets redone, harmlessly, on the next
 * run that reaches this series.
 */
export interface DiscoveryPort {
  /** Tracked series, their known provider refs, and when each was last discovered. */
  trackedSeries(): Promise<DiscoveryCandidate[]>;
  /** Fetches what the series' providers currently know, resolved and deduped. */
  discover(refs: SeriesRef[]): Promise<ResolvedBook[]>;
  /** Writes one resolved entry. Safe to call again for an entry already known. */
  persist(book: ResolvedBook): Promise<{ bookId: string; seriesId: string | null }>;
  markDiscovered(seriesIds: string[], at: Date): Promise<void>;
}

export interface DiscoveryResult {
  seriesExamined: number;
  entriesFound: number;
  entriesPersisted: number;
  failures: Array<{ seriesId: string; reason: string }>;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs series discovery for a bounded, deterministic slice of tracked
 * series. Closes the spec gap in section 8 ("the app owns discovering new
 * entries"): this is what makes discovery recur on a schedule instead of
 * running exactly once, at track time.
 *
 * Failure isolation mirrors runRefresh (run.ts): one series whose provider
 * is down, or whose entries fail to persist, does not stop the rest of the
 * slice, and is deliberately NOT marked discovered so it stays near the
 * front of the queue on the next run instead of rotating to the back.
 */
export async function runSeriesDiscovery(
  port: DiscoveryPort,
  now: Date,
  sliceSize?: number,
): Promise<DiscoveryResult> {
  const slice = selectDiscoverySlice(await port.trackedSeries(), sliceSize);

  let entriesFound = 0;
  let entriesPersisted = 0;
  const succeeded: string[] = [];
  const failures: DiscoveryResult["failures"] = [];

  for (const candidate of slice) {
    try {
      const entries = await port.discover(candidate.refs);
      entriesFound += entries.length;

      for (const entry of entries) {
        await port.persist(entry);
        entriesPersisted += 1;
      }

      succeeded.push(candidate.seriesId);
    } catch (error) {
      failures.push({ seriesId: candidate.seriesId, reason: reasonOf(error) });
      console.error(`discover: series ${candidate.seriesId} failed: ${reasonOf(error)}`);
    }
  }

  if (succeeded.length > 0) await port.markDiscovered(succeeded, now);

  return {
    seriesExamined: slice.length,
    entriesFound,
    entriesPersisted,
    failures,
  };
}
