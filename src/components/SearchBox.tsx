"use client";

import { useEffect, useState } from "react";
import { useDebounced } from "@/hooks/useDebounced";
import type { ResolvedBook } from "@/resolution/resolve";
import { SearchResult } from "./SearchResult";

interface Props {
  onSelect: (book: ResolvedBook) => void;
}

export function SearchBox({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ResolvedBook[]>([]);
  const [loading, setLoading] = useState(false);
  const debounced = useDebounced(query, 300);

  const isQueryLongEnough = debounced.trim().length >= 2;

  useEffect(() => {
    if (!isQueryLongEnough) {
      return;
    }

    const controller = new AbortController();
    // Fetching in response to a debounced query is the documented pattern for
    // syncing with an external system; the loading flag must flip the moment
    // the request starts, so it cannot be deferred into the promise chain.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

      <ul aria-live="polite" className="flex flex-col">
        {displayedResults.map((book) => (
          <SearchResult key={book.key} book={book} onSelect={onSelect} />
        ))}
      </ul>

      {showEmptyState ? (
        <p className="text-sm opacity-70">
          Nothing found. You can add it by hand instead.
        </p>
      ) : null}
    </div>
  );
}
