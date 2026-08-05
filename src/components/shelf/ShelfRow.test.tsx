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
    render(
      <ShelfRow
        entry={entry({ coverUrl: "/api/cover/abc" })}
        now={NOW}
      />,
    );
    const img = screen.getByRole("img", { name: "The Doors of Stone" });
    expect(img.getAttribute("src")).toBe("/api/cover/abc");
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
