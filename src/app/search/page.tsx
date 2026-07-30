"use client";

import { useState } from "react";
import { SearchBox } from "@/components/SearchBox";
import { TrackPrompt } from "@/components/TrackPrompt";
import type { ResolvedBook } from "@/resolution/resolve";

export default function SearchPage() {
  const [selected, setSelected] = useState<ResolvedBook | null>(null);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 font-display text-[26px] text-body">
        Add something to track
      </h1>
      <SearchBox onSelect={setSelected} />
      {selected ? (
        <TrackPrompt book={selected} onDone={() => setSelected(null)} />
      ) : null}
    </main>
  );
}
