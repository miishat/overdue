// The shape below is the shared contract between the service worker's push
// handler (src/sw.ts) and Task 11, which builds push payloads on the
// server. Both sides import this module rather than each defining the
// shape independently, so the contract cannot drift into two literals.
export interface PushPayload {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
}

// Defensive by design: must never throw, on any input. A malformed or
// unexpected payload should be rejected, not raise an exception, since the
// caller (the service worker's push handler) treats a rejection as "show
// nothing" rather than "crash silently and invisibly".
export function isPushPayload(value: unknown): value is PushPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.title !== "string" || candidate.title.length === 0) {
    return false;
  }
  if (candidate.body !== undefined && typeof candidate.body !== "string") {
    return false;
  }
  if (candidate.url !== undefined && typeof candidate.url !== "string") {
    return false;
  }
  if (candidate.tag !== undefined && typeof candidate.tag !== "string") {
    return false;
  }
  return true;
}
