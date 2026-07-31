/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GAP_MIN_DASHED_WIDTH, Gap } from "./Gap";

afterEach(() => cleanup());

function gapEl(container: HTMLElement): Element | null {
  return container.querySelector("[data-gap]");
}

describe("Gap", () => {
  it("renders a dashed void at or above the threshold width", () => {
    const { container } = render(<Gap width={60} />);
    expect(gapEl(container)?.getAttribute("data-gap")).toBe("dashed");
  });

  it("renders a dashed void at exactly the threshold", () => {
    const { container } = render(<Gap width={GAP_MIN_DASHED_WIDTH} />);
    expect(gapEl(container)?.getAttribute("data-gap")).toBe("dashed");
  });

  it("degrades to a solid block below the threshold", () => {
    const { container } = render(<Gap width={GAP_MIN_DASHED_WIDTH - 1} />);
    expect(gapEl(container)?.getAttribute("data-gap")).toBe("block");
  });

  it("pins the threshold at the spec's 44px", () => {
    expect(GAP_MIN_DASHED_WIDTH).toBe(44);
  });

  it("holds 2:3 cover proportions", () => {
    const { container } = render(<Gap width={60} />);
    const el = gapEl(container) as HTMLElement;
    expect(el.style.width).toBe("60px");
    expect(el.style.height).toBe("90px");
  });

  it("is hidden from assistive technology, since the row already states status", () => {
    const { container } = render(<Gap width={60} />);
    expect(gapEl(container)?.getAttribute("aria-hidden")).toBe("true");
  });
});
