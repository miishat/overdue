/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ShelfEntry } from "@/lib/synthesise";
import { ShelfRow } from "./ShelfRow";

afterEach(() => cleanup());

const NOW = new Date("2026-07-29T00:00:00Z");

function entry(overrides: Partial<ShelfEntry> = {}): ShelfEntry {
  return {
    key: "k",
    bookId: "b1",
    seriesId: null,
    title: "The Doors of Stone",
    authorName: "Patrick Rothfuss",
    seriesTitle: null,
    seriesPosition: null,
    coverUrl: null,
    status: "DATED",
    date: new Date("2026-09-14T00:00:00Z"),
    precision: "day",
    synthetic: false,
    lastSeriesReleaseAt: null,
    ...overrides,
  };
}

describe("ShelfRow", () => {
  it("renders the title", () => {
    render(<ShelfRow entry={entry()} now={NOW} />);
    expect(screen.getByText("The Doors of Stone")).toBeTruthy();
  });

  it("renders the author when there is one", () => {
    render(<ShelfRow entry={entry()} now={NOW} />);
    expect(screen.getByText("Patrick Rothfuss")).toBeTruthy();
  });

  it("renders a series badge with position when the book is in a series", () => {
    render(
      <ShelfRow
        entry={entry({
          seriesTitle: "The Kingkiller Chronicle",
          seriesPosition: 3,
        })}
        now={NOW}
      />,
    );
    expect(
      screen.getByText("The Kingkiller Chronicle, book 3"),
    ).toBeTruthy();
  });

  it("emits exactly four grid slots, which the theme contract depends on", () => {
    const { container } = render(<ShelfRow entry={entry()} now={NOW} />);
    const slots = container.querySelectorAll("[data-slot]");
    const names = Array.from(slots).map((s) => s.getAttribute("data-slot"));
    expect(names).toEqual(["cover", "identity", "status", "date"]);
  });

  it("renders a gap in the cover slot when there is no cover", () => {
    const { container } = render(<ShelfRow entry={entry()} now={NOW} />);
    expect(container.querySelector("[data-gap]")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders a real cover image when there is one", () => {
    // The stored coverUrl is a provider address (e.g. openlibrary), not
    // something we render directly; see the "ShelfRow covers" describe block
    // below for that routing behaviour. Here bookId defaults to "b1", so the
    // expected src is the proxy path keyed on it.
    render(
      <ShelfRow
        entry={entry({
          coverUrl: "https://covers.openlibrary.org/b/id/1-L.jpg",
        })}
        now={NOW}
      />,
    );
    const img = screen.getByRole("img", { name: "The Doors of Stone" });
    expect(img.getAttribute("src")).toBe("/api/covers/b1");
  });

  it("always renders a gap for a synthetic entry, even if a cover leaked in", () => {
    const { container } = render(
      <ShelfRow
        entry={entry({ synthetic: true, coverUrl: "/should-be-ignored" })}
        now={NOW}
      />,
    );
    expect(container.querySelector("[data-gap]")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });

  it("links a real book to its detail page", () => {
    render(<ShelfRow entry={entry({ bookId: "b9" })} now={NOW} />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/books/b9");
  });

  it("links a synthetic entry to its series, since it has no book page", () => {
    render(
      <ShelfRow
        entry={entry({ synthetic: true, bookId: null, seriesId: "s4" })}
        now={NOW}
      />,
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe("/series/s4");
  });

  it("renders no link when there is neither a book nor a series to point at", () => {
    render(
      <ShelfRow
        entry={entry({ bookId: null, seriesId: null, synthetic: true })}
        now={NOW}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders the changed badge when the entry is marked changed", () => {
    render(<ShelfRow entry={entry()} now={NOW} changed />);
    expect(screen.getByText("New")).toBeTruthy();
  });

  it("renders no changed badge when the entry is not marked changed", () => {
    render(<ShelfRow entry={entry()} now={NOW} />);
    expect(screen.queryByText("New")).toBeNull();
  });

  it("still emits exactly four grid slots with the changed badge present, which the theme contract depends on", () => {
    const { container } = render(<ShelfRow entry={entry()} now={NOW} changed />);
    const slots = container.querySelectorAll("[data-slot]");
    const names = Array.from(slots).map((s) => s.getAttribute("data-slot"));
    expect(names).toEqual(["cover", "identity", "status", "date"]);
  });
});

describe("ShelfRow covers", () => {
  const BOOK_ID = "11111111-2222-3333-4444-555555555555";

  it("renders the cover through our own origin, never the provider url", () => {
    render(
      <ShelfRow
        entry={entry({
          bookId: BOOK_ID,
          title: "A Book",
          coverUrl: "https://covers.openlibrary.org/b/id/1-L.jpg",
          synthetic: false,
        })}
        now={NOW}
      />,
    );

    const img = screen.getByRole("img", { name: "A Book" });
    expect(img.getAttribute("src")).toBe(`/api/covers/${BOOK_ID}`);
    expect(img.getAttribute("src")).not.toContain("openlibrary");
  });

  it("renders a Gap rather than a broken proxy call when the stored url is unusable", () => {
    // container.querySelector("img"), not screen.queryByRole("img"):
    // StatusRule (src/components/shelf/StatusRule.tsx:78) gives its status
    // marker role="img" unconditionally, on every row, as the accessible
    // label for a colour-only rule. An unnamed role query would match that
    // span regardless of whether a cover rendered; querying the actual img
    // tag is what the existing gap tests above already do.
    const { container } = render(
      <ShelfRow
        entry={entry({
          bookId: BOOK_ID,
          coverUrl: "http://covers.openlibrary.org/b/id/1-L.jpg",
          synthetic: false,
        })}
        now={NOW}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
  });

  it("still renders a Gap for a synthetic entry that somehow carries a cover", () => {
    const { container } = render(
      <ShelfRow
        entry={entry({
          bookId: null,
          coverUrl: "https://covers.openlibrary.org/b/id/1-L.jpg",
          synthetic: true,
        })}
        now={NOW}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
  });
});
