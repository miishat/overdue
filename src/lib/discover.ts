import { getSeriesEntriesFromAll, type SeriesRef } from "@/providers/registry";
import { groupByIdentity } from "@/resolution/identity";
import { resolveGroup, type ResolvedBook } from "@/resolution/resolve";

export async function discoverSeriesEntries(
  refs: SeriesRef[],
): Promise<ResolvedBook[]> {
  if (refs.length === 0) return [];

  const records = await getSeriesEntriesFromAll(refs);

  return groupByIdentity(records)
    .map(resolveGroup)
    .sort((a, b) => {
      const left = a.seriesPosition ?? Number.POSITIVE_INFINITY;
      const right = b.seriesPosition ?? Number.POSITIVE_INFINITY;
      return left - right;
    });
}
