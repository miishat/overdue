import { describe, expect, it } from "vitest";
import { buildDateChangeAlert } from "./alert";
import { isPushPayload } from "./payload";

describe("buildDateChangeAlert", () => {
  it("states both dates on a slip to a later date", () => {
    const payload = buildDateChangeAlert({
      bookTitle: "The Long Winter",
      bookId: "book-1",
      from: "2028-01-15",
      to: "2028-03-01",
      fromPrecision: "day",
      toPrecision: "day",
    });
    expect(payload.body).toBe(
      "The Long Winter was pushed back from 15 Jan 2028 to 1 Mar 2028.",
    );
  });

  it("states both dates on a move to an earlier date", () => {
    const payload = buildDateChangeAlert({
      bookTitle: "The Long Winter",
      bookId: "book-1",
      from: "2028-03-01",
      to: "2028-01-15",
      fromPrecision: "day",
      toPrecision: "day",
    });
    expect(payload.body).toBe(
      "The Long Winter was moved up from 1 Mar 2028 to 15 Jan 2028.",
    );
  });

  it("renders a season-to-day move at each date's own precision", () => {
    const payload = buildDateChangeAlert({
      bookTitle: "The Long Winter",
      bookId: "book-1",
      from: "2027-09-01",
      to: "2028-01-15",
      fromPrecision: "season",
      toPrecision: "day",
    });
    expect(payload.body).toBe(
      "The Long Winter was pushed back from Fall 2027 to 15 Jan 2028.",
    );
  });

  it("announces a first-ever date being set", () => {
    const payload = buildDateChangeAlert({
      bookTitle: "The Long Winter",
      bookId: "book-1",
      from: null,
      to: "2028-03-01",
      fromPrecision: null,
      toPrecision: "day",
    });
    expect(payload.body).toBe(
      "The Long Winter now has a release date: 1 Mar 2028.",
    );
  });

  it("announces a first-ever date being set at season precision", () => {
    const payload = buildDateChangeAlert({
      bookTitle: "The Long Winter",
      bookId: "book-1",
      from: null,
      to: "2027-09-01",
      fromPrecision: null,
      toPrecision: "season",
    });
    expect(payload.body).toBe(
      "The Long Winter now has a release date: Fall 2027.",
    );
  });

  it("announces a date being withdrawn", () => {
    const payload = buildDateChangeAlert({
      bookTitle: "The Long Winter",
      bookId: "book-1",
      from: "2028-03-01",
      to: null,
      fromPrecision: "day",
      toPrecision: null,
    });
    expect(payload.body).toBe(
      "The Long Winter's release date has been withdrawn. It was 1 Mar 2028.",
    );
  });

  it("announces a withdrawn date that was only known to season precision", () => {
    const payload = buildDateChangeAlert({
      bookTitle: "The Long Winter",
      bookId: "book-1",
      from: "2027-09-01",
      to: null,
      fromPrecision: "season",
      toPrecision: null,
    });
    expect(payload.body).toBe(
      "The Long Winter's release date has been withdrawn. It was Fall 2027.",
    );
  });

  it("includes the book title in the copy", () => {
    const payload = buildDateChangeAlert({
      bookTitle: "A Rare Title Nobody Else Uses",
      bookId: "book-1",
      from: "2028-01-15",
      to: "2028-03-01",
      fromPrecision: "day",
      toPrecision: "day",
    });
    expect(payload.body).toContain("A Rare Title Nobody Else Uses");
  });

  it("points the url at /books/<id>", () => {
    const payload = buildDateChangeAlert({
      bookTitle: "The Long Winter",
      bookId: "book-42",
      from: "2028-01-15",
      to: "2028-03-01",
      fromPrecision: "day",
      toPrecision: "day",
    });
    expect(payload.url).toBe("/books/book-42");
  });

  it("uses a tag that is stable for the same book", () => {
    const first = buildDateChangeAlert({
      bookTitle: "The Long Winter",
      bookId: "book-1",
      from: "2028-01-15",
      to: "2028-03-01",
      fromPrecision: "day",
      toPrecision: "day",
    });
    const second = buildDateChangeAlert({
      bookTitle: "The Long Winter",
      bookId: "book-1",
      from: null,
      to: "2028-06-01",
      fromPrecision: null,
      toPrecision: "day",
    });
    expect(first.tag).toBe(second.tag);
  });

  it("uses a tag that differs across books", () => {
    const bookOne = buildDateChangeAlert({
      bookTitle: "The Long Winter",
      bookId: "book-1",
      from: "2028-01-15",
      to: "2028-03-01",
      fromPrecision: "day",
      toPrecision: "day",
    });
    const bookTwo = buildDateChangeAlert({
      bookTitle: "A Different Book",
      bookId: "book-2",
      from: "2028-01-15",
      to: "2028-03-01",
      fromPrecision: "day",
      toPrecision: "day",
    });
    expect(bookOne.tag).not.toBe(bookTwo.tag);
  });

  it("degrades an absent precision to something sensible rather than throwing", () => {
    const payload = buildDateChangeAlert({
      bookTitle: "The Long Winter",
      bookId: "book-1",
      from: "2028-01-15",
      to: "2028-03-01",
    });
    expect(payload.body).toBe(
      "The Long Winter was pushed back from 15 Jan 2028 to 1 Mar 2028.",
    );
  });

  it("produces a payload that satisfies isPushPayload", () => {
    const cases = [
      {
        bookTitle: "A",
        bookId: "1",
        from: "2028-01-15",
        to: "2028-03-01",
        fromPrecision: "day" as const,
        toPrecision: "day" as const,
      },
      {
        bookTitle: "B",
        bookId: "2",
        from: null,
        to: "2028-03-01",
        fromPrecision: null,
        toPrecision: "day" as const,
      },
      {
        bookTitle: "C",
        bookId: "3",
        from: "2028-03-01",
        to: null,
        fromPrecision: "day" as const,
        toPrecision: null,
      },
    ];
    for (const input of cases) {
      const payload = buildDateChangeAlert(input);
      expect(isPushPayload(payload)).toBe(true);
    }
  });
});
