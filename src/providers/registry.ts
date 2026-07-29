import type { ProviderName } from "@/db/schema/enums";
import { googleBooksProvider } from "./google-books";
import { hardcoverProvider } from "./hardcover";
import { openLibraryProvider } from "./open-library";
import type { MetadataProvider, ProviderBook } from "./types";
import { wikidataProvider } from "./wikidata";

export interface SeriesRef {
  provider: ProviderName;
  externalId: string;
}

export const providers: MetadataProvider[] = [
  hardcoverProvider,
  wikidataProvider,
  openLibraryProvider,
  googleBooksProvider,
];

// Manual entries have no MetadataProvider adapter (there is nothing to
// fetch), but they are the most official source there is: the user typed
// it in themselves. Combining that with each adapter's own `official` flag
// gives one place that knows what counts as official, instead of a second,
// hand-maintained list of provider names that can drift out of sync.
function buildOfficialProviders(): Record<ProviderName, boolean> {
  const map = { manual: true } as Record<ProviderName, boolean>;
  for (const provider of providers) {
    map[provider.name] = provider.official;
  }
  return map;
}

export const OFFICIAL_PROVIDERS: Record<ProviderName, boolean> = buildOfficialProviders();

// Per-provider deadline for a single search/lookup call. Long enough for a
// healthy provider to answer, short enough that a typeahead still feels
// alive. A provider that misses this deadline contributes nothing, exactly
// as if it had failed outright (see combineSignals + fetchJson's abort
// handling), rather than holding up the rest of the batch.
export const PROVIDER_TIMEOUT_MS = 4000;

// Combines the caller's own cancellation (e.g. a request's AbortSignal
// threaded through from the search route) with a per-call timeout, so a
// provider is cut off by whichever fires first.
function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

export async function searchAcross(
  list: MetadataProvider[],
  query: string,
  signal?: AbortSignal,
  timeoutMs: number = PROVIDER_TIMEOUT_MS,
): Promise<ProviderBook[]> {
  const settled = await Promise.allSettled(
    list.map((p) => p.searchBooks(query, withTimeout(signal, timeoutMs))),
  );

  return settled.flatMap((outcome) =>
    outcome.status === "fulfilled" ? outcome.value : [],
  );
}

export function searchAllProviders(
  query: string,
  signal?: AbortSignal,
): Promise<ProviderBook[]> {
  return searchAcross(providers, query, signal);
}

export async function getSeriesEntriesFromProviders(
  list: MetadataProvider[],
  refs: SeriesRef[],
  signal?: AbortSignal,
  timeoutMs: number = PROVIDER_TIMEOUT_MS,
): Promise<ProviderBook[]> {
  const settled = await Promise.allSettled(
    refs.map((ref) => {
      const provider = list.find((p) => p.name === ref.provider);
      if (!provider) return Promise.resolve([]);
      return provider.getSeriesEntries(ref.externalId, withTimeout(signal, timeoutMs));
    }),
  );

  return settled.flatMap((outcome) =>
    outcome.status === "fulfilled" ? outcome.value : [],
  );
}

export async function getSeriesEntriesFromAll(
  refs: SeriesRef[],
  signal?: AbortSignal,
): Promise<ProviderBook[]> {
  return getSeriesEntriesFromProviders(providers, refs, signal);
}
