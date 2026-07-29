"use client";

import { useEffect, useState } from "react";
import { useDebounced } from "@/hooks/useDebounced";
import type { ResolvedBook } from "@/resolution/resolve";
import { SearchResult } from "./SearchResult";

interface Props {
  onSelect: (book: ResolvedBook) => void;
}

interface ManualFormState {
  title: string;
  author: string;
  notes: string;
  sourceUrl: string;
}

export function SearchBox({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ResolvedBook[]>([]);
  const [loading, setLoading] = useState(false);
  const [manualForm, setManualForm] = useState<ManualFormState | null>(null);
  const [manualPending, setManualPending] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const debounced = useDebounced(query, 300);

  const isQueryLongEnough = debounced.trim().length >= 2;

  useEffect(() => {
    if (!isQueryLongEnough) {
      // Clears a loading flag left stuck true when the query drops back
      // under the threshold while a request is still in flight: the effect
      // cleanup below sets `cancelled`, so the in-flight request's
      // `.finally` skips `setLoading(false)`, and this early return never
      // ran it either.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    // Fetching in response to a debounced query is the documented pattern for
    // syncing with an external system; the loading flag must flip the moment
    // the request starts, so it cannot be deferred into the promise chain.
    setLoading(true);

    // Guards against a superseded request's handlers running after a newer
    // request has already resolved. Every keystroke can abort the previous
    // fetch and start a new one, but an aborted fetch's promise chain still
    // settles (often via rejection, but ordering is not guaranteed), so
    // without this check a slow, stale response could overwrite fresher
    // results or flip loading off while a newer request is still in flight.
    // Do not remove this as "redundant" with the abort call above.
    let cancelled = false;

    fetch(`/api/search?q=${encodeURIComponent(debounced)}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : { results: [] }))
      .then((data: { results?: ResolvedBook[] }) => {
        if (cancelled) return;
        setResults(data.results ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setResults([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [debounced, isQueryLongEnough]);

  const displayedResults = isQueryLongEnough ? results : [];
  const showEmptyState =
    !loading && isQueryLongEnough && displayedResults.length === 0;

  // Re-seed the manual form (prefilling the title) each time a fresh query
  // settles into an empty result set, but leave it alone while the user is
  // still editing the same empty-state form (submit failures included).
  useEffect(() => {
    if (showEmptyState) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setManualForm({ title: debounced, author: "", notes: "", sourceUrl: "" });
      setManualError(null);
    }
  }, [showEmptyState, debounced]);

  async function handleManualSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!manualForm || manualPending) return;

    setManualPending(true);
    setManualError(null);

    try {
      const res = await fetch("/api/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(manualForm),
      });

      if (!res.ok) {
        setManualError("Couldn't save that. Try again.");
        return;
      }

      setQuery("");
      setManualForm(null);
    } catch {
      setManualError("Couldn't save that. Try again.");
    } finally {
      setManualPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="search" className="sr-only">
        Search for a book or author
      </label>
      <input
        id="search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Title or author"
        className="rounded-sm border px-3 py-2"
        autoComplete="off"
      />

      <p aria-live="polite" className="text-sm opacity-70">
        {loading ? "Searching..." : ""}
      </p>

      <ul aria-live="polite" className="flex flex-col">
        {displayedResults.map((book) => (
          <SearchResult key={book.key} book={book} onSelect={onSelect} />
        ))}
      </ul>

      {showEmptyState && manualForm ? (
        <form
          onSubmit={(event) => {
            void handleManualSubmit(event);
          }}
          className="flex flex-col gap-2 border-t pt-3"
        >
          <p className="text-sm opacity-70">
            Can&rsquo;t find it? Add it by hand and it&rsquo;ll take priority
            over anything providers report later.
          </p>

          <label htmlFor="manual-title" className="text-sm">
            Title
          </label>
          <input
            id="manual-title"
            type="text"
            value={manualForm.title}
            onChange={(event) =>
              setManualForm({ ...manualForm, title: event.target.value })
            }
            className="rounded-sm border px-3 py-2"
            required
          />

          <label htmlFor="manual-author" className="text-sm">
            Author (optional)
          </label>
          <input
            id="manual-author"
            type="text"
            value={manualForm.author}
            onChange={(event) =>
              setManualForm({ ...manualForm, author: event.target.value })
            }
            className="rounded-sm border px-3 py-2"
          />

          <label htmlFor="manual-notes" className="text-sm">
            Notes (optional)
          </label>
          <input
            id="manual-notes"
            type="text"
            value={manualForm.notes}
            onChange={(event) =>
              setManualForm({ ...manualForm, notes: event.target.value })
            }
            className="rounded-sm border px-3 py-2"
          />

          <label htmlFor="manual-source-url" className="text-sm">
            Source URL (optional)
          </label>
          <input
            id="manual-source-url"
            type="text"
            value={manualForm.sourceUrl}
            onChange={(event) =>
              setManualForm({ ...manualForm, sourceUrl: event.target.value })
            }
            className="rounded-sm border px-3 py-2"
            placeholder="Where did you see this? e.g. the author's blog"
          />

          {manualError ? (
            <p role="alert" className="text-sm text-red-600">
              {manualError}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={manualPending || manualForm.title.trim().length === 0}
            className="self-start rounded-sm border px-3 py-2 text-sm disabled:opacity-50"
          >
            {manualPending ? "Adding..." : "Add it by hand"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
