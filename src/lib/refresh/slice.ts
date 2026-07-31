/**
 * How many books one refresh run processes.
 *
 * Bounded because scheduled runs on free tiers are best-effort: a run that
 * tries to refresh everything will eventually hit a platform timeout and leave
 * the system half-updated. A bounded slice always completes, and because the
 * ordering is oldest-first, every tracked item is reached eventually.
 */
export const DEFAULT_SLICE_SIZE = 25;

export interface Sliceable {
  bookId: string;
  lastRefreshedAt: Date | null;
}

/**
 * Oldest-refreshed first, never-refreshed before that.
 *
 * A newly tracked book has nothing to compare against and is the most likely
 * to be wrong, so it goes to the front. Ties break on bookId so two runs over
 * the same data pick the same slice.
 */
export function selectSlice<T extends Sliceable>(
  candidates: T[],
  now: Date,
  size: number = DEFAULT_SLICE_SIZE,
): T[] {
  return [...candidates]
    .sort((a, b) => {
      if (a.lastRefreshedAt === null && b.lastRefreshedAt === null) {
        return a.bookId.localeCompare(b.bookId);
      }
      if (a.lastRefreshedAt === null) return -1;
      if (b.lastRefreshedAt === null) return 1;

      const byAge = a.lastRefreshedAt.getTime() - b.lastRefreshedAt.getTime();
      if (byAge !== 0) return byAge;

      return a.bookId.localeCompare(b.bookId);
    })
    .slice(0, size);
}
