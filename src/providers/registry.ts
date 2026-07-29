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

export async function searchAcross(
  list: MetadataProvider[],
  query: string,
  signal?: AbortSignal,
): Promise<ProviderBook[]> {
  const settled = await Promise.allSettled(
    list.map((p) => p.searchBooks(query, signal)),
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
): Promise<ProviderBook[]> {
  const settled = await Promise.allSettled(
    refs.map((ref) => {
      const provider = list.find((p) => p.name === ref.provider);
      if (!provider) return Promise.resolve([]);
      return provider.getSeriesEntries(ref.externalId, signal);
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
