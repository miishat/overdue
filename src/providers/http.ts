/**
 * Shared safe JSON fetching for provider adapters.
 *
 * Design principle: assume every external source will be wrong, stale, or
 * missing something. `fetchJson` never throws and never rejects; any
 * failure (network error, non-2xx status, invalid JSON body) degrades to
 * `null` so callers can treat "no data" uniformly instead of needing
 * try/catch at every call site.
 */

export async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    // AbortError (a cancelled request, e.g. the caller's AbortSignal fired)
    // is swallowed here rather than rethrown. Callers already treat a null
    // return as "no data available"; letting an aborted search collapse to
    // an empty result is simpler than requiring every caller to special
    // case cancellation, and search UIs cancel in-flight requests routinely
    // as the user keeps typing.
    return null;
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
