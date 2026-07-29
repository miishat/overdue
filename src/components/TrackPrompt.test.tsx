// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedBook } from "@/resolution/resolve";
import { TrackPrompt } from "./TrackPrompt";

function makeBook(overrides: Partial<ResolvedBook> = {}): ResolvedBook {
  return {
    key: "book-1",
    title: "The Way of Kings",
    authors: ["Brandon Sanderson"],
    provenance: {},
    sources: [],
    confidence: 80,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("TrackPrompt", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(201));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders 'Track the series' as primary and 'Just this book' as secondary when the book has a series", () => {
    const book = makeBook({ seriesName: "The Stormlight Archive" });
    render(<TrackPrompt book={book} onDone={vi.fn()} />);

    expect(screen.getByText(/The Stormlight Archive/)).toBeTruthy();

    const primary = screen.getByRole("button", { name: "Track the series" });
    expect(primary.tagName).toBe("BUTTON");

    const secondary = screen.getByText("Just this book");
    expect(secondary).toBeTruthy();
  });

  it("offers only a single 'Track this book' action when the book has no series", () => {
    const book = makeBook({ seriesName: undefined });
    render(<TrackPrompt book={book} onDone={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "Track this book" }),
    ).toBeTruthy();
    expect(screen.queryByText("Track the series")).toBeNull();
    expect(screen.queryByText("Just this book")).toBeNull();
  });

  it("posts scope: series when 'Track the series' is clicked", async () => {
    const book = makeBook({ seriesName: "The Stormlight Archive" });
    const onDone = vi.fn();
    render(<TrackPrompt book={book} onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: "Track the series" }));
    await flush();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/track",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ book, scope: "series" }),
      }),
    );
    expect(onDone).toHaveBeenCalled();
  });

  it("posts scope: book when 'Just this book' is clicked", async () => {
    const book = makeBook({ seriesName: "The Stormlight Archive" });
    const onDone = vi.fn();
    render(<TrackPrompt book={book} onDone={onDone} />);

    fireEvent.click(screen.getByText("Just this book"));
    await flush();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/track",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ book, scope: "book" }),
      }),
    );
    expect(onDone).toHaveBeenCalled();
  });

  it("posts scope: book when 'Track this book' is clicked for a book without a series", async () => {
    const book = makeBook({ seriesName: undefined });
    const onDone = vi.fn();
    render(<TrackPrompt book={book} onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: "Track this book" }));
    await flush();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/track",
      expect.objectContaining({
        body: JSON.stringify({ book, scope: "book" }),
      }),
    );
    expect(onDone).toHaveBeenCalled();
  });

  it("surfaces an error and does not call onDone when the request fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: "boom" }));
    const book = makeBook({ seriesName: undefined });
    const onDone = vi.fn();
    render(<TrackPrompt book={book} onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: "Track this book" }));

    await waitFor(() => {
      expect(
        screen.getByText("Could not save that. Try again."),
      ).toBeTruthy();
    });
    expect(onDone).not.toHaveBeenCalled();
  });
});
