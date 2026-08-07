import { describe, expect, it } from "vitest";
import type { ResolvedBook } from "@/resolution/resolve";
import {
  runSeriesDiscovery,
  type DiscoveryCandidate,
  type DiscoveryPort,
} from "./discovery-run";

const NOW = new Date("2026-07-30T00:00:00Z");

function candidate(
  seriesId: string,
  lastDiscoveredAt: string | null,
  overrides: Partial<DiscoveryCandidate> = {},
): DiscoveryCandidate {
  return {
    seriesId,
    lastDiscoveredAt: lastDiscoveredAt ? new Date(lastDiscoveredAt) : null,
    refs: [{ provider: "hardcover", externalId: seriesId }],
    ...overrides,
  };
}

function entry(key: string): ResolvedBook {
  return {
    key,
    title: `Book ${key}`,
    authors: [],
    provenance: {},
    sources: [{ provider: "hardcover", externalId: key }],
    confidence: 80,
  };
}

interface Recorded {
  discovered: string[][];
  persisted: string[];
  marked: string[][];
}

function port(overrides: Partial<DiscoveryPort> = {}): {
  port: DiscoveryPort;
  recorded: Recorded;
} {
  const recorded: Recorded = { discovered: [], persisted: [], marked: [] };

  const base: DiscoveryPort = {
    async trackedSeries() {
      return [candidate("s1", null)];
    },
    async discover(refs) {
      recorded.discovered.push(refs.map((r) => r.externalId));
      return [];
    },
    async persist(book) {
      recorded.persisted.push(book.key);
      return { bookId: book.key, seriesId: null };
    },
    async markDiscovered(seriesIds) {
      recorded.marked.push(seriesIds);
    },
    ...overrides,
  };

  return { port: base, recorded };
}

describe("runSeriesDiscovery", () => {
  it("examines nothing and marks nothing when there are no tracked series", async () => {
    const { port: p, recorded } = port({ async trackedSeries() { return []; } });
    const result = await runSeriesDiscovery(p, NOW);

    expect(result.seriesExamined).toBe(0);
    expect(result.entriesFound).toBe(0);
    expect(result.entriesPersisted).toBe(0);
    expect(result.failures).toEqual([]);
    expect(recorded.marked).toEqual([]);
  });

  it("persists every entry discover returns and marks the series discovered", async () => {
    const { port: p, recorded } = port({
      async trackedSeries() {
        return [candidate("s1", null)];
      },
      async discover() {
        return [entry("b1"), entry("b2")];
      },
    });

    const result = await runSeriesDiscovery(p, NOW);

    expect(result.seriesExamined).toBe(1);
    expect(result.entriesFound).toBe(2);
    expect(result.entriesPersisted).toBe(2);
    expect(recorded.persisted).toEqual(["b1", "b2"]);
    expect(recorded.marked).toEqual([["s1"]]);
  });

  // Bounded, oldest-first: never-discovered series come before a
  // recently-discovered one, mirroring selectDiscoverySlice's own tests.
  it("orders never-discovered series before discovered ones and respects the slice bound", async () => {
    const seen: string[] = [];
    const { port: p } = port({
      async trackedSeries() {
        return [
          candidate("recent", "2026-07-29T00:00:00Z"),
          candidate("never", null),
          candidate("stale", "2026-01-01T00:00:00Z"),
        ];
      },
      async discover(refs) {
        seen.push(refs[0].externalId);
        return [];
      },
    });

    await runSeriesDiscovery(p, NOW, 2);

    expect(seen).toEqual(["never", "stale"]);
  });

  // Failure isolation: one series whose provider is down must not stop the
  // rest of the slice, and must not be marked discovered, mirroring
  // runRefresh's per-book isolation in run.ts.
  it("does not let a failing series stop the others, and does not mark it discovered", async () => {
    const { port: p, recorded } = port({
      async trackedSeries() {
        return [candidate("bad", null), candidate("good", null)];
      },
      async discover(refs) {
        if (refs[0].externalId === "bad") {
          throw new Error("provider unreachable");
        }
        return [entry("b1")];
      },
    });

    const result = await runSeriesDiscovery(p, NOW);

    expect(result.failures).toEqual([{ seriesId: "bad", reason: "provider unreachable" }]);
    expect(recorded.persisted).toEqual(["b1"]);
    // Only the series that succeeded is marked discovered.
    expect(recorded.marked).toEqual([["good"]]);
  });

  it("does not mark a series discovered when persisting one of its entries fails", async () => {
    const { port: p, recorded } = port({
      async trackedSeries() {
        return [candidate("s1", null)];
      },
      async discover() {
        return [entry("b1"), entry("b2")];
      },
      async persist(book) {
        if (book.key === "b2") throw new Error("write failed");
        recorded.persisted.push(book.key);
        return { bookId: book.key, seriesId: null };
      },
    });

    const result = await runSeriesDiscovery(p, NOW);

    expect(result.failures).toEqual([{ seriesId: "s1", reason: "write failed" }]);
    expect(recorded.marked).toEqual([]);
  });

  // persistResolvedBook already deduplicates via external_ids (see
  // src/lib/persist.ts), so re-persisting an entry the port already knows
  // about is an update, not a new row. The orchestration layer must not
  // add its own duplicate-suppression on top: every entry discover returns
  // gets persisted, every time, and the counts reflect exactly that.
  it("does not duplicate entries already known: persists them again as an idempotent update", async () => {
    const { port: p, recorded } = port({
      async trackedSeries() {
        return [candidate("s1", "2026-07-01T00:00:00Z")];
      },
      async discover() {
        return [entry("known-book")];
      },
    });

    const first = await runSeriesDiscovery(p, NOW);
    const second = await runSeriesDiscovery(p, NOW);

    expect(first.entriesPersisted).toBe(1);
    expect(second.entriesPersisted).toBe(1);
    expect(recorded.persisted).toEqual(["known-book", "known-book"]);
  });

  it("is deterministic: two runs over the same data process series in the same order", async () => {
    const orderA: string[] = [];
    const orderB: string[] = [];

    const candidates = [
      candidate("c", "2026-07-01T00:00:00Z"),
      candidate("a", "2026-07-01T00:00:00Z"),
      candidate("b", "2026-07-01T00:00:00Z"),
    ];

    const { port: p1 } = port({
      async trackedSeries() {
        return candidates;
      },
      async discover(refs) {
        orderA.push(refs[0].externalId);
        return [];
      },
    });
    const { port: p2 } = port({
      async trackedSeries() {
        return [...candidates].reverse();
      },
      async discover(refs) {
        orderB.push(refs[0].externalId);
        return [];
      },
    });

    await runSeriesDiscovery(p1, NOW);
    await runSeriesDiscovery(p2, NOW);

    expect(orderA).toEqual(["a", "b", "c"]);
    expect(orderB).toEqual(["a", "b", "c"]);
  });
});
