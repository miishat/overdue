/**
 * How many tracked series one discovery pass processes.
 *
 * Deliberately smaller than DEFAULT_SLICE_SIZE (25, see slice.ts), because
 * discovery is far more expensive per item than a book refresh. A book
 * refresh candidate costs a fixed, small amount of work per book. A series
 * discovery candidate costs one provider call per ref (see
 * discoverSeriesEntries in ../discover.ts) PLUS one full persistResolvedBook
 * (several statements each: upsertSeries, findExistingBookId, upsertAuthors,
 * the releases upsert, and the release_sources delete+insert batch, see
 * ../persist.ts) for EVERY entry the series returns. A long-running series
 * can return dozens of entries, so the per-candidate cost is not fixed the
 * way a book refresh candidate's is.
 *
 * Hardcover's documented limit is 60 requests/minute on a personal token
 * (see docs/superpowers/specs/2026-07-28-overdue-design.md). Book refresh and
 * series discovery run inside the SAME /api/refresh invocation (see
 * src/app/api/refresh/route.ts), so their Hardcover call budgets are
 * additive within one run: book refresh can issue up to DEFAULT_SLICE_SIZE
 * (25) Hardcover calls, one per candidate whose known sources include
 * Hardcover. Discovery refs are restricted to hardcover and wikidata (see
 * discovery-run.ts), so each series discovery candidate issues at most one
 * Hardcover call of its own. 25 (books) + 10 (series) = 35, comfortably
 * under 60 even in the pathological case where every call in a run happens
 * to land inside the same 60-second window.
 */
export const DEFAULT_DISCOVERY_SLICE_SIZE = 10;

export interface DiscoverySliceable {
  seriesId: string;
  lastDiscoveredAt: Date | null;
}

/**
 * Oldest-discovered first, never-discovered before that. Mirrors
 * selectSlice (slice.ts) exactly: a never-discovered series has the least
 * complete book list and is the most likely to be missing an entry, so it
 * goes to the front, and ties break on seriesId so two runs over the same
 * data pick the same slice.
 */
export function selectDiscoverySlice<T extends DiscoverySliceable>(
  candidates: T[],
  size: number = DEFAULT_DISCOVERY_SLICE_SIZE,
): T[] {
  return [...candidates]
    .sort((a, b) => {
      if (a.lastDiscoveredAt === null && b.lastDiscoveredAt === null) {
        return a.seriesId.localeCompare(b.seriesId);
      }
      if (a.lastDiscoveredAt === null) return -1;
      if (b.lastDiscoveredAt === null) return 1;

      const byAge = a.lastDiscoveredAt.getTime() - b.lastDiscoveredAt.getTime();
      if (byAge !== 0) return byAge;

      return a.seriesId.localeCompare(b.seriesId);
    })
    .slice(0, size);
}
