import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { series } from "@/db/schema/catalog";
import { externalIds } from "@/db/schema/identity";
import { tracks } from "@/db/schema/tracking";
import { getCurrentUserId } from "@/lib/current-user";
import { discoverSeriesEntries } from "@/lib/discover";
import { persistResolvedBook } from "@/lib/persist";
import type { SeriesRef } from "@/providers/registry";
import type { DiscoveryCandidate, DiscoveryPort } from "./discovery-run";

/**
 * The only two providers with a getSeriesEntries adapter (see
 * src/providers/registry.ts: hardcover.ts and wikidata.ts implement it,
 * open-library.ts and google-books.ts do not). Matches the restriction
 * src/app/api/track/route.ts already applies to its own, track-time-only
 * discovery call, so a series behaves the same way whether it is discovered
 * at track time or by this scheduled port.
 */
const SERIES_REF_PROVIDERS = new Set(["hardcover", "wikidata"]);

/**
 * Live DiscoveryPort backed by Drizzle/Postgres.
 *
 * Mirrors createDrizzleRefreshPort (port.ts): the pure orchestration in
 * discovery-run.ts is injected with this at the one place production needs
 * it (src/app/api/refresh/route.ts), and every other test in the codebase
 * exercises runSeriesDiscovery through a fake.
 */
export function createDrizzleDiscoveryPort(): DiscoveryPort {
  return {
    async trackedSeries() {
      const userId = await getCurrentUserId();

      const trackRows = await db
        .select({ seriesId: tracks.seriesId })
        .from(tracks)
        .where(and(eq(tracks.userId, userId), isNotNull(tracks.seriesId)));

      const seriesIds = trackRows
        .map((row) => row.seriesId)
        .filter((id): id is string => id !== null);
      if (seriesIds.length === 0) return [];

      const seriesRows = await db
        .select({ id: series.id, lastDiscoveredAt: series.lastDiscoveredAt })
        .from(series)
        .where(inArray(series.id, seriesIds));

      const refRows = await db
        .select({
          entityId: externalIds.entityId,
          provider: externalIds.provider,
          externalId: externalIds.externalId,
        })
        .from(externalIds)
        .where(
          and(
            eq(externalIds.entityType, "series"),
            inArray(externalIds.entityId, seriesIds),
          ),
        );

      const refsBySeriesId = new Map<string, SeriesRef[]>();
      for (const row of refRows) {
        if (!SERIES_REF_PROVIDERS.has(row.provider)) continue;
        const list = refsBySeriesId.get(row.entityId) ?? [];
        list.push({ provider: row.provider, externalId: row.externalId });
        refsBySeriesId.set(row.entityId, list);
      }

      const candidates: DiscoveryCandidate[] = [];
      for (const row of seriesRows) {
        const refs = refsBySeriesId.get(row.id);
        // A series with no hardcover/wikidata ref (a manual-only track, or one
        // whose only provenance is a provider without a series endpoint) can
        // never produce anything from discoverSeriesEntries: refs.length === 0
        // short-circuits it to an empty array (see src/lib/discover.ts).
        // Leaving it out of the slice entirely means a slot in the bounded
        // slice is never spent on a candidate that can only ever no-op.
        if (!refs || refs.length === 0) continue;
        candidates.push({ seriesId: row.id, lastDiscoveredAt: row.lastDiscoveredAt, refs });
      }

      return candidates;
    },

    async discover(refs) {
      return discoverSeriesEntries(refs);
    },

    async persist(book) {
      return persistResolvedBook(book);
    },

    async markDiscovered(seriesIds, at) {
      if (seriesIds.length === 0) return;
      await db
        .update(series)
        .set({ lastDiscoveredAt: at })
        .where(inArray(series.id, seriesIds));
    },
  };
}

/** The port production uses: the real database and the real providers. */
export const drizzleDiscoveryPort: DiscoveryPort = createDrizzleDiscoveryPort();
