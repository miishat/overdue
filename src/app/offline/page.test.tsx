// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import OfflinePage from "./page";

afterEach(cleanup);

describe("the offline page", () => {
  it("says plainly that this is a connection problem, not a missing page", () => {
    render(<OfflinePage />);

    expect(
      screen.getByRole("heading", { name: "You are offline" }),
    ).toBeTruthy();
  });

  it("tells the user what still works, because something does", () => {
    render(<OfflinePage />);

    expect(screen.getByText(/already opened/i)).toBeTruthy();
  });

  it("offers a way back rather than being a dead end", () => {
    render(<OfflinePage />);

    expect(screen.getByRole("link", { name: /waiting shelf/i })).toBeTruthy();
  });
});
