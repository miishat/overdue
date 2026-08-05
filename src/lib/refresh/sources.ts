import type { DatePrecision, ProviderName } from "@/db/schema/enums";
import { PROVIDER_TIMEOUT_MS, withTimeout } from "@/providers/registry";
import type { MetadataProvider, ProviderBook } from "@/providers/types";

/** One (provider, externalId) pair this book is already known by. */
export interface KnownSource {
  provider: ProviderName;
  externalId: string;
}

/** The stored release row plus its current source rows. */
export interface StoredRelease {
  id: string;
  date: string | null;
  datePrecision: DatePrecision | null;
  sources: Array<{
    provider: ProviderName;
    sourceUrl: string | null;
    valueSeen: string | null;
    trustRank: number;
  }>;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Rebuilds the stored manual source as a ProviderBook so it re-enters the
 * resolution.
 *
 * Manual has no MetadataProvider adapter, so a naive re-fetch simply drops it.
 * That is destructive rather than merely lossy: persistResolvedBook DELETEs
 * and re-INSERTs release_sources from the resolved source list, so a manual
 * row that did not survive the fetch is erased and the date is re-derived from
 * providers alone. Manual outranks every other provider on every field without
 * exception, so it must be fed back in.
 *
 * Only the release date is reconstructed, because release_sources.value_seen
 * is the only manual value we store. title is deliberately left empty so that
 * resolveGroup's hasValue check skips manual for title and the providers still
 * get to move it.
 */
export function manualRecord(
  externalId: string,
  release: StoredRelease | null,
): ProviderBook {
  const source = release?.sources.find((row) => row.provider === "manual");
  const valueSeen = source?.valueSeen ?? null;

  // A manual source that never carried a date contributes no field, but it
  // must still be present so persist re-inserts its release_sources row.
  if (valueSeen === null) {
    return {
      provider: "manual",
      externalId,
      title: "",
      authors: [],
      sourceUrl: source?.sourceUrl ?? undefined,
    };
  }

  // Manual outranks everything, so a stored manual date that is NOT the
  // release's current date means the two disagree in a way this reconstruction
  // cannot explain, and there is no per-source precision to fall back on.
  // Throwing records a per-book failure and leaves the manual row untouched,
  // which is the only safe outcome.
  if (release?.date !== valueSeen) {
    throw new Error(
      `manual source ${externalId} reports ${valueSeen} but the release stores ${release?.date ?? "null"}; refusing to refresh rather than risk destroying manual data`,
    );
  }

  return {
    provider: "manual",
    externalId,
    title: "",
    authors: [],
    releaseDate: valueSeen,
    datePrecision: release?.datePrecision ?? undefined,
    sourceUrl: source?.sourceUrl ?? undefined,
  };
}

/**
 * Re-fetches every provider this book is already known by.
 *
 * ALL-OR-NOTHING, unlike searchAcross. A search that loses a provider is
 * merely thinner; a refresh that loses one goes on to OVERWRITE stored state
 * from a survivors-only resolution. If hardcover (trust 80) times out while
 * google (trust 30) answers, the stored date would be rewritten to google's
 * value, a change_log row appended and a date_change push fired; next run
 * hardcover recovers and it all flips back, for a second row and a second
 * push. So any rejection from a known source aborts the refetch by throwing,
 * and runRefresh's per-book catch leaves the book unmarked and unchanged. A
 * refresh that cannot see all of a book's known sources must not conclude
 * anything about that book.
 *
 * Every call is bounded by the registry's own withTimeout/PROVIDER_TIMEOUT_MS
 * rather than a second, parallel timeout mechanism. A hung provider would
 * otherwise stall the run until the platform kills the function, which is
 * precisely the mid-run death the deferred write-back exists to survive.
 */
export async function fetchKnownSources(
  list: MetadataProvider[],
  rows: KnownSource[],
  release: StoredRelease | null,
  signal?: AbortSignal,
  timeoutMs: number = PROVIDER_TIMEOUT_MS,
): Promise<ProviderBook[]> {
  const fetchable = rows.filter((row) => row.provider !== "manual");
  const manualRows = rows.filter((row) => row.provider === "manual");

  const settled = await Promise.allSettled(
    fetchable.map((row) => {
      const provider = list.find((p) => p.name === row.provider);
      // A known source with no adapter is a source we cannot see, which is
      // the same situation as a rejection, not a reason to proceed regardless.
      if (!provider) {
        return Promise.reject(
          new Error(`no adapter for known source provider ${row.provider}`),
        );
      }
      return provider.getBook(row.externalId, withTimeout(signal, timeoutMs));
    }),
  );

  const rejected = settled.flatMap((outcome, index) =>
    outcome.status === "rejected"
      ? [`${fetchable[index].provider}: ${reasonOf(outcome.reason)}`]
      : [],
  );
  if (rejected.length > 0) {
    throw new Error(
      `known sources unavailable, refusing to refresh: ${rejected.join("; ")}`,
    );
  }

  const fetched = settled.flatMap((outcome) =>
    outcome.status === "fulfilled" && outcome.value ? [outcome.value] : [],
  );

  // No provider still knows this book. The caller treats an empty result as a
  // changeless refresh and writes nothing, so a manual-only book keeps
  // everything it has.
  if (fetched.length === 0) return [];

  // Manual is appended last so it is never resolveGroup's records[0] title
  // fallback, but it still wins every field it actually carries.
  return [...fetched, ...manualRows.map((row) => manualRecord(row.externalId, release))];
}
