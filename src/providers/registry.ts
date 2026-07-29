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
