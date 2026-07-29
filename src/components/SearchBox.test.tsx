// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedBook } from "@/resolution/resolve";
import { SearchBox } from "./SearchBox";

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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("SearchBox", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not fetch for a query under 2 characters", async () => {
    render(<SearchBox onSelect={vi.fn()} />);
    const input = screen.getByLabelText("Search for a book or author");

    fireEvent.change(input, { target: { value: "a" } });

    act(() => {
      vi.advanceTimersByTime(500);
    });
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches once for a settled query, not once per keystroke", async () => {
    render(<SearchBox onSelect={vi.fn()} />);
    const input = screen.getByLabelText("Search for a book or author");

    // Simulate keystrokes arriving faster than the debounce delay.
    fireEvent.change(input, { target: { value: "t" } });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.change(input, { target: { value: "to" } });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.change(input, { target: { value: "tolkien" } });

    act(() => {
      vi.advanceTimersByTime(500);
    });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/search?q=tolkien",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("shows the empty state when the API returns zero results for a valid query", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }));
    render(<SearchBox onSelect={vi.fn()} />);
    const input = screen.getByLabelText("Search for a book or author");

    fireEvent.change(input, { target: { value: "zzznotfound" } });

    act(() => {
      vi.advanceTimersByTime(500);
    });
    await flush();

    expect(
      screen.getByText("Nothing found. You can add it by hand instead."),
    ).toBeTruthy();
  });

  it("renders results with series badges from the API response", async () => {
    const book = makeBook({ seriesName: "The Lord of the Rings", seriesPosition: 1 });
    fetchMock.mockResolvedValue(jsonResponse({ results: [book] }));
    render(<SearchBox onSelect={vi.fn()} />);
    const input = screen.getByLabelText("Search for a book or author");

    fireEvent.change(input, { target: { value: "fellowship" } });

    act(() => {
      vi.advanceTimersByTime(500);
    });
    await flush();

    expect(
      screen.getByText("Book 1 of The Lord of the Rings"),
    ).toBeTruthy();
  });
});
