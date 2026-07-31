import { describe, expect, it } from "vitest";
import { buildDigest, type DigestItem } from "./digest";
import { isPushPayload } from "./payload";

describe("buildDigest", () => {
  it("returns null for an empty list", () => {
    expect(buildDigest([])).toBeNull();
  });

  it("builds a single-item payload that reads naturally, not '1 update'", () => {
    const items: DigestItem[] = [
      {
        kind: "released_today",
        bookTitle: "The Long Winter",
        bookId: "book-1",
        date: null,
      },
    ];
    const payload = buildDigest(items);
    expect(payload).not.toBeNull();
    expect(payload!.title).toBe("Update");
    expect(payload!.body).toBe("The Long Winter is out today.");
    expect(payload!.body).not.toMatch(/1 update/i);
  });

  it("batches several items into one payload with the count in the copy", () => {
    const items: DigestItem[] = [
      {
        kind: "released_today",
        bookTitle: "The Long Winter",
        bookId: "book-1",
        date: null,
      },
      {
        kind: "upcoming",
        bookTitle: "Second Sun",
        bookId: "book-2",
        date: "2028-03-01",
      },
      {
        kind: "announced",
        bookTitle: "Third Wave",
        bookId: "book-3",
        date: "2029-01-01",
      },
    ];
    const payload = buildDigest(items);
    expect(payload).not.toBeNull();
    expect(payload!.title).toBe("3 updates");
    expect(payload!.body).toBe(
      "The Long Winter is out today. Second Sun releases 2028-03-01. Third Wave was announced for 2029-01-01.",
    );
  });

  it("uses the same fixed tag regardless of contents", () => {
    const single = buildDigest([
      {
        kind: "released_today",
        bookTitle: "A",
        bookId: "book-1",
        date: null,
      },
    ]);
    const multiple = buildDigest([
      { kind: "released_today", bookTitle: "A", bookId: "book-1", date: null },
      {
        kind: "upcoming",
        bookTitle: "B",
        bookId: "book-2",
        date: "2028-03-01",
      },
    ]);
    expect(single!.tag).toBe(multiple!.tag);
  });

  it("produces a payload that satisfies isPushPayload for every non-empty case", () => {
    const cases: DigestItem[][] = [
      [
        {
          kind: "released_today",
          bookTitle: "A",
          bookId: "book-1",
          date: null,
        },
      ],
      [
        {
          kind: "upcoming",
          bookTitle: "A",
          bookId: "book-1",
          date: "2028-03-01",
        },
        {
          kind: "announced",
          bookTitle: "B",
          bookId: "book-2",
          date: null,
        },
      ],
    ];
    for (const items of cases) {
      const payload = buildDigest(items);
      expect(payload).not.toBeNull();
      expect(isPushPayload(payload)).toBe(true);
    }
  });
});
