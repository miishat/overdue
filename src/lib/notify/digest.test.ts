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
        datePrecision: "day",
      },
      {
        kind: "announced",
        bookTitle: "Third Wave",
        bookId: "book-3",
        date: "2029-01-01",
        datePrecision: "year",
      },
    ];
    const payload = buildDigest(items);
    expect(payload).not.toBeNull();
    expect(payload!.title).toBe("3 updates");
    expect(payload!.body).toBe(
      "The Long Winter is out today. Second Sun releases 1 Mar 2028. Third Wave was announced for 2029.",
    );
  });

  it("renders an upcoming item known only to season precision without asserting a day", () => {
    const items: DigestItem[] = [
      {
        kind: "upcoming",
        bookTitle: "Second Sun",
        bookId: "book-2",
        date: "2028-06-01",
        datePrecision: "season",
      },
    ];
    const payload = buildDigest(items);
    expect(payload!.body).toBe("Second Sun releases Summer 2028.");
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
        datePrecision: "day",
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
          datePrecision: "day",
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
