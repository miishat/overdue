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
    });
    expect(payload.body).toBe(
      "The Long Winter was pushed back from 2028-01-15 to 2028-03-01.",
    );
  });

  it("states both dates on a move to an earlier date", () => {
    const payload = buildDateChangeAlert({
      bookTitle: "The Long Winter",
      bookId: "book-1",
      from: "2028-03-01",
      to: "2028-01-15",
    });
    expect(payload.body).toBe(
      "The Long Winter was moved up from 2028-03-01 to 2028-01-15.",
    );
  });

  it("announces a first-ever date being set", () => {
    const payload = buildDateChangeAlert({
      bookTitle: "The Long Winter",
      bookId: "book-1",
      from: null,
      to: "2028-03-01",
    });
    expect(payload.body).toBe(
      "The Long Winter now has a release date: 2028-03-01.",
    );
  });

  it("announces a date being withdrawn", () => {
    const payload = buildDateChangeAlert({
      bookTitle: "The Long Winter",
      bookId: "book-1",
      from: "2028-03-01",
      to: null,
    });
    expect(payload.body).toBe(
      "The Long Winter's release date has been withdrawn. It was 2028-03-01.",
    );
  });

  it("includes the book title in the copy", () => {
    const payload = buildDateChangeAlert({
      bookTitle: "A Rare Title Nobody Else Uses",
      bookId: "book-1",
      from: "2028-01-15",
      to: "2028-03-01",
    });
    expect(payload.body).toContain("A Rare Title Nobody Else Uses");
  });

  it("points the url at /books/<id>", () => {
    const payload = buildDateChangeAlert({
      bookTitle: "The Long Winter",
      bookId: "book-42",
      from: "2028-01-15",
      to: "2028-03-01",
    });
    expect(payload.url).toBe("/books/book-42");
  });

  it("uses a tag that is stable for the same book", () => {
    const first = buildDateChangeAlert({
      bookTitle: "The Long Winter",
      bookId: "book-1",
      from: "2028-01-15",
      to: "2028-03-01",
    });
    const second = buildDateChangeAlert({
      bookTitle: "The Long Winter",
      bookId: "book-1",
      from: null,
      to: "2028-06-01",
    });
    expect(first.tag).toBe(second.tag);
  });

  it("uses a tag that differs across books", () => {
    const bookOne = buildDateChangeAlert({
      bookTitle: "The Long Winter",
      bookId: "book-1",
      from: "2028-01-15",
      to: "2028-03-01",
    });
    const bookTwo = buildDateChangeAlert({
      bookTitle: "A Different Book",
      bookId: "book-2",
      from: "2028-01-15",
      to: "2028-03-01",
    });
    expect(bookOne.tag).not.toBe(bookTwo.tag);
  });

  it("produces a payload that satisfies isPushPayload", () => {
    const cases = [
      { bookTitle: "A", bookId: "1", from: "2028-01-15", to: "2028-03-01" },
      { bookTitle: "B", bookId: "2", from: null, to: "2028-03-01" },
      { bookTitle: "C", bookId: "3", from: "2028-03-01", to: null },
    ];
    for (const input of cases) {
      const payload = buildDateChangeAlert(input);
      expect(isPushPayload(payload)).toBe(true);
    }
  });
});
