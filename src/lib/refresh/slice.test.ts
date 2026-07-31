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
});
