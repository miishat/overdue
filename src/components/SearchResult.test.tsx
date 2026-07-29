// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedBook } from "@/resolution/resolve";
import { SearchResult } from "./SearchResult";

afterEach(() => cleanup());

function makeBook(overrides: Partial<ResolvedBook> = {}): ResolvedBook {
  return {
    key: "book-1",
    title: "The Fellowship of the Ring",
    authors: ["J.R.R. Tolkien"],
    provenance: {},
    sources: [],
    confidence: 1,
    ...overrides,
  };
}

describe("SearchResult", () => {
  it("renders the series badge when both seriesPosition and seriesName are present", () => {
    const book = makeBook({ seriesName: "Some Series", seriesPosition: 2 });
    render(
      <ul>
        <SearchResult book={book} onSelect={vi.fn()} />
      </ul>,
    );
    expect(screen.getByText("Book 2 of Some Series")).toBeTruthy();
  });

  it("renders no badge when neither seriesPosition nor seriesName is present", () => {
    const book = makeBook();
    render(
      <ul>
        <SearchResult book={book} onSelect={vi.fn()} />
      </ul>,
    );
    expect(screen.queryByText(/Book \d+ of/)).toBeNull();
  });

  it("renders an aria-hidden placeholder instead of an img when coverUrl is absent", () => {
    const book = makeBook({ coverUrl: undefined });
    const { container } = render(
      <ul>
        <SearchResult book={book} onSelect={vi.fn()} />
      </ul>,
    );
    expect(container.querySelector("img")).toBeNull();
    const placeholder = container.querySelector("span[aria-hidden='true']");
    expect(placeholder).not.toBeNull();
  });
});
