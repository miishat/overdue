import { describe, expect, it } from "vitest";
import {
  DEFAULT_DISCOVERY_SLICE_SIZE,
  selectDiscoverySlice,
  type DiscoverySliceable,
} from "./discovery-slice";

function item(seriesId: string, lastDiscoveredAt: string | null): DiscoverySliceable {
  return {
    seriesId,
    lastDiscoveredAt: lastDiscoveredAt ? new Date(lastDiscoveredAt) : null,
  };
}

describe("selectDiscoverySlice", () => {
  it("returns never-discovered series first", () => {
    const slice = selectDiscoverySlice([
      item("a", "2026-07-29T00:00:00Z"),
      item("b", null),
    ]);
    expect(slice.map((i) => i.seriesId)).toEqual(["b", "a"]);
  });

  it("orders discovered series oldest first", () => {
    const slice = selectDiscoverySlice([
      item("recent", "2026-07-29T00:00:00Z"),
      item("stale", "2026-01-01T00:00:00Z"),
    ]);
    expect(slice.map((i) => i.seriesId)).toEqual(["stale", "recent"]);
  });

  it("caps the slice at the default size", () => {
    const many = Array.from({ length: 100 }, (_, i) => item(`s${i}`, null));
    expect(selectDiscoverySlice(many)).toHaveLength(DEFAULT_DISCOVERY_SLICE_SIZE);
  });

  it("honours an explicit size", () => {
    const many = Array.from({ length: 100 }, (_, i) => item(`s${i}`, null));
    expect(selectDiscoverySlice(many, 3)).toHaveLength(3);
  });

  it("returns everything when there are fewer candidates than the size", () => {
    expect(selectDiscoverySlice([item("a", null)], 10)).toHaveLength(1);
  });

  it("returns an empty slice for no candidates", () => {
    expect(selectDiscoverySlice([])).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = [item("a", "2026-07-29T00:00:00Z"), item("b", null)];
    const before = input.map((i) => i.seriesId);
    selectDiscoverySlice(input);
    expect(input.map((i) => i.seriesId)).toEqual(before);
  });

  it("breaks ties deterministically by seriesId", () => {
    const same = "2026-07-01T00:00:00Z";
    const slice = selectDiscoverySlice([
      item("b", same),
      item("a", same),
      item("c", same),
    ]);
    expect(slice.map((i) => i.seriesId)).toEqual(["a", "b", "c"]);
  });

  it("pins the default slice size below the book slice size", () => {
    expect(DEFAULT_DISCOVERY_SLICE_SIZE).toBe(10);
    expect(DEFAULT_DISCOVERY_SLICE_SIZE).toBeLessThan(25);
  });

  // The cap must apply AFTER ordering, exactly as selectSlice requires (see
  // slice.test.ts): capping first would defeat the whole point of ordering
  // by picking whichever series happened to arrive first in the input.
  it("applies the cap after ordering, not before", () => {
    const recent = Array.from({ length: DEFAULT_DISCOVERY_SLICE_SIZE }, (_, i) =>
      item(`recent-${String(i).padStart(2, "0")}`, "2026-07-29T00:00:00Z"),
    );
    const ancient = item("ancient", "2020-01-01T00:00:00Z");
    const never = item("never", null);

    const slice = selectDiscoverySlice([...recent, ancient, never]);

    expect(slice).toHaveLength(DEFAULT_DISCOVERY_SLICE_SIZE);
    expect(slice[0].seriesId).toBe("never");
    expect(slice[1].seriesId).toBe("ancient");
    expect(slice.map((i) => i.seriesId)).not.toContain(
      `recent-${String(DEFAULT_DISCOVERY_SLICE_SIZE - 1).padStart(2, "0")}`,
    );
  });

  it("picks the same tied items whatever order they arrive in", () => {
    const same = "2026-07-01T00:00:00Z";
    const forward = selectDiscoverySlice(
      [item("a", same), item("b", same), item("c", same)],
      2,
    );
    const reversed = selectDiscoverySlice(
      [item("c", same), item("b", same), item("a", same)],
      2,
    );

    expect(forward.map((i) => i.seriesId)).toEqual(["a", "b"]);
    expect(reversed.map((i) => i.seriesId)).toEqual(["a", "b"]);
  });
});
