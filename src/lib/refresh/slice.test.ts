import { describe, expect, it } from "vitest";
import { DEFAULT_SLICE_SIZE, selectSlice, type Sliceable } from "./slice";

const NOW = new Date("2026-07-30T00:00:00Z");

function item(bookId: string, lastRefreshedAt: string | null): Sliceable {
  return {
    bookId,
    lastRefreshedAt: lastRefreshedAt ? new Date(lastRefreshedAt) : null,
  };
}

describe("selectSlice", () => {
  it("returns never-refreshed items first", () => {
    const slice = selectSlice(
      [item("a", "2026-07-29T00:00:00Z"), item("b", null)],
      NOW,
    );
    expect(slice.map((i) => i.bookId)).toEqual(["b", "a"]);
  });

  it("orders refreshed items oldest first", () => {
    const slice = selectSlice(
      [
        item("recent", "2026-07-29T00:00:00Z"),
        item("stale", "2026-01-01T00:00:00Z"),
      ],
      NOW,
    );
    expect(slice.map((i) => i.bookId)).toEqual(["stale", "recent"]);
  });

  it("caps the slice at the default size", () => {
    const many = Array.from({ length: 100 }, (_, i) => item(`b${i}`, null));
    expect(selectSlice(many, NOW)).toHaveLength(DEFAULT_SLICE_SIZE);
  });

  it("honours an explicit size", () => {
    const many = Array.from({ length: 100 }, (_, i) => item(`b${i}`, null));
    expect(selectSlice(many, NOW, 5)).toHaveLength(5);
  });

  it("returns everything when there are fewer candidates than the size", () => {
    expect(selectSlice([item("a", null)], NOW, 10)).toHaveLength(1);
  });

  it("returns an empty slice for no candidates", () => {
    expect(selectSlice([], NOW)).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = [item("a", "2026-07-29T00:00:00Z"), item("b", null)];
    const before = input.map((i) => i.bookId);
    selectSlice(input, NOW);
    expect(input.map((i) => i.bookId)).toEqual(before);
  });

  it("breaks ties deterministically by bookId", () => {
    const same = "2026-07-01T00:00:00Z";
    const slice = selectSlice(
      [item("b", same), item("a", same), item("c", same)],
      NOW,
    );
    expect(slice.map((i) => i.bookId)).toEqual(["a", "b", "c"]);
  });

  it("pins the default slice size", () => {
    expect(DEFAULT_SLICE_SIZE).toBe(25);
  });

  // The cap must be applied AFTER ordering. Capping first would take whichever
  // books happened to arrive at the front of the input and defeat the whole
  // point of the ordering: the stalest books would never be reached.
  //
  // The candidates that must survive are deliberately placed at the END of the
  // input, so a slice-before-sort implementation drops exactly the ones the
  // ordering exists to prioritise.
  it("applies the cap after ordering, not before", () => {
    const recent = Array.from({ length: DEFAULT_SLICE_SIZE }, (_, i) =>
      item(`recent-${String(i).padStart(2, "0")}`, "2026-07-29T00:00:00Z"),
    );
    const ancient = item("ancient", "2020-01-01T00:00:00Z");
    const never = item("never", null);

    const slice = selectSlice([...recent, ancient, never], NOW);

    expect(slice).toHaveLength(DEFAULT_SLICE_SIZE);
    // Never-refreshed first, then the oldest refreshed, then the rest.
    expect(slice[0].bookId).toBe("never");
    expect(slice[1].bookId).toBe("ancient");
    // The newest book must have been displaced off the end of the slice.
    expect(slice.map((i) => i.bookId)).not.toContain(
      `recent-${String(DEFAULT_SLICE_SIZE - 1).padStart(2, "0")}`,
    );
  });

  // Determinism means the same set produces the same slice regardless of the
  // order the rows arrived in. A comparator that returned 0 for ties would
  // pass a single-ordering test while still making two runs disagree.
  it("picks the same tied items whatever order they arrive in", () => {
    const same = "2026-07-01T00:00:00Z";
    const forward = selectSlice(
      [item("a", same), item("b", same), item("c", same)],
      NOW,
      2,
    );
    const reversed = selectSlice(
      [item("c", same), item("b", same), item("a", same)],
      NOW,
      2,
    );

    expect(forward.map((i) => i.bookId)).toEqual(["a", "b"]);
    expect(reversed.map((i) => i.bookId)).toEqual(["a", "b"]);
  });
});
