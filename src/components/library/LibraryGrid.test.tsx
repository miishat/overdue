/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ReadStateValue } from "@/db/schema/enums";
import type { ShelfEntry } from "@/lib/synthesise";
import { LibraryGrid } from "./LibraryGrid";

afterEach(() => cleanup());

const NOW = new Date("2026-07-29T00:00:00Z");

function entry(overrides: Partial<ShelfEntry> = {}): ShelfEntry {
  return {
    key: "k",
    bookId: "b1",
    seriesId: null,
    title: "A Book",
    authorName: null,
    seriesTitle: null,
    seriesPosition: null,
    coverUrl: null,
    status: "RELEASED",
    date: new Date("2020-01-01T00:00:00Z"),
    precision: "day",
    synthetic: false,
    lastSeriesReleaseAt: null,
    ...overrides,
  };
}

describe("LibraryGrid", () => {
  it("shows the read state for a book that has one", () => {
    render(
      <LibraryGrid
        entries={[entry({ bookId: "b1" })]}
        now={NOW}
        readStates={new Map<string, ReadStateValue>([["b1", "read"]])}
        completeSeriesIds={new Set()}
      />,
    );
    expect(screen.getByText("Read")).toBeTruthy();
  });

  it("shows nothing where a book has no read state", () => {
    render(
      <LibraryGrid
        entries={[entry()]}
        now={NOW}
        readStates={new Map()}
        completeSeriesIds={new Set()}
      />,
    );
    expect(screen.queryByText("Read")).toBeNull();
  });

  it("renders an inviting empty state", () => {
    render(
      <LibraryGrid
        entries={[]}
        now={NOW}
        readStates={new Map()}
        completeSeriesIds={new Set()}
      />,
    );
    expect(screen.getByText("Nothing tracked yet.")).toBeTruthy();
  });

  it("marks a row whose series is in the complete set", () => {
    render(
      <LibraryGrid
        entries={[entry({ seriesId: "s1" })]}
        now={NOW}
        readStates={new Map()}
        completeSeriesIds={new Set(["s1"])}
      />,
    );
    expect(screen.getByText("Series complete")).toBeTruthy();
  });

  it("does not mark a row whose series is not in the complete set", () => {
    render(
      <LibraryGrid
        entries={[entry({ seriesId: "s1" })]}
        now={NOW}
        readStates={new Map()}
        completeSeriesIds={new Set(["other-series"])}
      />,
    );
    expect(screen.queryByText("Series complete")).toBeNull();
  });

  it("does not mark, and does not crash on, a row with a null seriesId", () => {
    render(
      <LibraryGrid
        entries={[entry({ seriesId: null })]}
        now={NOW}
        readStates={new Map()}
        completeSeriesIds={new Set(["s1"])}
      />,
    );
    expect(screen.queryByText("Series complete")).toBeNull();
  });

  it("shows both the complete marker and the read state label on one row", () => {
    render(
      <LibraryGrid
        entries={[entry({ bookId: "b1", seriesId: "s1" })]}
        now={NOW}
        readStates={new Map<string, ReadStateValue>([["b1", "read"]])}
        completeSeriesIds={new Set(["s1"])}
      />,
    );
    expect(screen.getByText("Series complete")).toBeTruthy();
    expect(screen.getByText("Read")).toBeTruthy();
  });

  it("renders 300 rows, the scale the spec designs for", () => {
    const entries = Array.from({ length: 300 }, (_, i) =>
      entry({ key: `k${i}`, bookId: `b${i}`, title: `Book ${i}` }),
    );
    render(
      <LibraryGrid
        entries={entries}
        now={NOW}
        readStates={new Map()}
        completeSeriesIds={new Set()}
      />,
    );
    expect(screen.getByText("Book 299")).toBeTruthy();
  });
});
