/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ShelfEntry } from "@/lib/synthesise";
import { DateColumn } from "./DateColumn";

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

describe("DateColumn", () => {
  it("renders a confirmed day date in full", () => {
    render(<DateColumn entry={entry()} now={NOW} />);
    expect(screen.getByText("14 Sep 2026")).toBeTruthy();
  });

  it("renders a season window as a window, not a false exact date", () => {
    render(
      <DateColumn
        entry={entry({
          status: "ESTIMATED",
          date: new Date("2027-09-01T00:00:00Z"),
          precision: "season",
        })}
        now={NOW}
      />,
    );
    expect(screen.getByText("Fall 2027")).toBeTruthy();
  });

  it("renders elapsed time for HIATUS, which is what separates it from EXPECTED", () => {
    render(
      <DateColumn
        entry={entry({
          status: "HIATUS",
          date: null,
          precision: null,
          lastSeriesReleaseAt: new Date("2011-03-01T00:00:00Z"),
        })}
        now={NOW}
      />,
    );
    expect(screen.getByText("15 yrs")).toBeTruthy();
  });

  it("renders nothing for EXPECTED, which is what separates it from HIATUS", () => {
    const { container } = render(
      <DateColumn
        entry={entry({
          status: "EXPECTED",
          date: null,
          precision: null,
          lastSeriesReleaseAt: new Date("2024-01-01T00:00:00Z"),
        })}
        now={NOW}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("renders nothing for ANNOUNCED, which is honestly empty", () => {
    const { container } = render(
      <DateColumn
        entry={entry({ status: "ANNOUNCED", date: null, precision: null })}
        now={NOW}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("falls back to blank for HIATUS with no known last release", () => {
    const { container } = render(
      <DateColumn
        entry={entry({
          status: "HIATUS",
          date: null,
          precision: null,
          lastSeriesReleaseAt: null,
        })}
        now={NOW}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("uses tabular figures so the column aligns down a list", () => {
    const { container } = render(<DateColumn entry={entry()} now={NOW} />);
    const el = container.querySelector("[data-date-column]");
    expect(el?.className).toContain("tabular-nums");
  });
});
