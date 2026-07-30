"use client";

import { useState } from "react";
import type { ReadStateValue } from "@/db/schema/enums";

const OPTIONS: { value: ReadStateValue; label: string }[] = [
  { value: "want", label: "Want" },
  { value: "reading", label: "Reading" },
  { value: "read", label: "Read" },
  { value: "skipped", label: "Skipped" },
];

/**
 * The one control on the book detail screen: set this book's read state.
 * Posts to the same /api/read-state endpoint Task 14 built, and to nothing
 * else. No notes editing, no date override; those are out of scope here.
 */
export function ReadStateControl({
  bookId,
  initialState,
}: {
  bookId: string;
  initialState: ReadStateValue | null;
}) {
  const [state, setState] = useState<ReadStateValue | null>(initialState);
  const [saving, setSaving] = useState(false);

  async function update(next: ReadStateValue) {
    setSaving(true);
    const res = await fetch("/api/read-state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bookId, state: next }),
    });
    setSaving(false);
    if (res.ok) setState(next);
  }

  return (
    <label className="flex items-center gap-2 font-mono text-[11px] uppercase text-quiet">
      Read state
      <select
        aria-label="Read state"
        value={state ?? ""}
        disabled={saving}
        onChange={(event) => update(event.target.value as ReadStateValue)}
        className="border border-rule bg-transparent px-2 py-1 text-body"
      >
        <option value="" disabled>
          Set
        </option>
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
