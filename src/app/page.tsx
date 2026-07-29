"use client";

import { useState } from "react";
import { SearchBox } from "@/components/SearchBox";
import { TrackPrompt } from "@/components/TrackPrompt";
import type { ResolvedBook } from "@/resolution/resolve";

export default function HomePage() {
  const [selected, setSelected] = useState<ResolvedBook | null>(null);

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-10">
      <h1 className="font-[family-name:var(--font-newsreader)] text-2xl">
        Add something to track
      </h1>
      <SearchBox onSelect={setSelected} />
      {selected ? (
        <TrackPrompt book={selected} onDone={() => setSelected(null)} />
      ) : null}
    </main>
  );
}
