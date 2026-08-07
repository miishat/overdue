"use client";

import { useState } from "react";
import type { ResolvedBook } from "@/resolution/resolve";

interface Props {
  book: ResolvedBook;
  onDone: () => void;
}

export function TrackPrompt({ book, onDone }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function track(scope: "series" | "book") {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ book, scope }),
    });
    setSaving(false);
    if (res.ok) {
      onDone();
    } else {
      setError("Could not save that. Try again.");
    }
  }

  if (!book.seriesName) {
    return (
      <div className="flex flex-col gap-3 border-t border-rule pt-4">
        <p className="text-sm">
          Track <span className="font-medium">{book.title}</span>?
        </p>
        <button
          type="button"
          disabled={saving}
          onClick={() => track("book")}
          className="rounded-sm border border-rule px-3 py-2"
        >
          Track this book
        </button>
        {error ? <p className="text-sm">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-t border-rule pt-4">
      <p className="text-sm">
        This is part of{" "}
        <span className="font-medium">{book.seriesName}</span>. Track the whole
        series?
      </p>
      <button
        type="button"
        disabled={saving}
        onClick={() => track("series")}
        className="rounded-sm border border-rule px-3 py-2 font-medium"
      >
        Track the series
      </button>
      <button
        type="button"
        disabled={saving}
        onClick={() => track("book")}
        className="text-sm underline opacity-70"
      >
        Just this book
      </button>
      {error ? <p className="text-sm">{error}</p> : null}
    </div>
  );
}
