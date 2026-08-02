/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ShelfEntry } from "@/lib/synthesise";
import { WaitingShelf } from "./WaitingShelf";

afterEach(() => cleanup());

const NOW = new Date("2026-07-29T00:00:00Z");

function entry(overrides: Partial<ShelfEntry> = {}): ShelfEntry {
  return {
    key: "k",
    bookId: "b1",
    seriesId: null,
    title: "A Book",
    authorName: null,
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

describe("WaitingShelf", () => {
  it("renders a horizon heading for each non-empty group", () => {
    render(
      <WaitingShelf
        entries={[
          entry({ key: "a", date: new Date("2026-07-30Z") }),
          entry({ key: "b", date: new Date("2029-01-01Z") }),
        ]}
        now={NOW}
      />,
    );
    expect(screen.getByRole("heading", { name: "This month" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Dated further out" }),
    ).toBeTruthy();
  });

  it("does not render a heading for an empty horizon", () => {
    render(<WaitingShelf entries={[entry()]} now={NOW} />);
    expect(screen.queryByRole("heading", { name: "No date yet" })).toBeNull();
  });

  it("renders an inviting empty state, not an apology", () => {
    render(<WaitingShelf entries={[]} now={NOW} />);
    expect(screen.getByText("Nothing on the shelf yet.")).toBeTruthy();
    const link = screen.getByRole("link", {
      name: "Find a book or series",
    });
    expect(link.getAttribute("href")).toBe("/search");
  });

  it("renders one row per entry", () => {
    render(
      <WaitingShelf
        entries={[entry({ key: "a" }), entry({ key: "b" })]}
        now={NOW}
      />,
    );
    expect(screen.getAllByText("A Book")).toHaveLength(2);
  });

  it("wires changedIds through to the badge on the right row only", () => {
    render(
      <WaitingShelf
        entries={[
          entry({ key: "a", bookId: "b1", title: "Changed Book" }),
          entry({ key: "b", bookId: "b2", title: "Unchanged Book" }),
        ]}
        now={NOW}
        changedIds={new Set(["b1"])}
      />,
    );

    const changedRow = screen.getByText("Changed Book").closest("div[class*='grid']");
    const unchangedRow = screen
      .getByText("Unchanged Book")
      .closest("div[class*='grid']");

    expect(changedRow).not.toBeNull();
    expect(unchangedRow).not.toBeNull();
    expect(changedRow?.querySelector("[data-badge='changed']")).toBeTruthy();
    expect(unchangedRow?.querySelector("[data-badge='changed']")).toBeNull();
  });
});
