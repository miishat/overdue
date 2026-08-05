/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NAV_DESTINATIONS, NavShell } from "./NavShell";

afterEach(() => cleanup());

describe("NavShell", () => {
  it("renders a link for every destination", () => {
    render(<NavShell>content</NavShell>);
    for (const destination of NAV_DESTINATIONS) {
      const link = screen.getByRole("link", { name: destination.label });
      expect(link.getAttribute("href")).toBe(destination.href);
    }
  });

  it("renders its children", () => {
    render(<NavShell>the page</NavShell>);
    expect(screen.getByText("the page")).toBeTruthy();
  });

  it("lists exactly the destinations that have a page", () => {
    const hrefs = NAV_DESTINATIONS.map((d) => d.href);
    expect(hrefs).toEqual(["/", "/library", "/search", "/settings"]);
  });

  it("marks the navigation as a landmark", () => {
    render(<NavShell>content</NavShell>);
    expect(screen.getByRole("navigation")).toBeTruthy();
  });
});
