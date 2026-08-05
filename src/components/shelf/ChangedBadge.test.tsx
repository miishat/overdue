/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChangedBadge } from "./ChangedBadge";

afterEach(() => cleanup());

describe("ChangedBadge", () => {
  it("renders a text label, not colour alone", () => {
    render(<ChangedBadge />);
    // getByText fails if the only signal were a colour class with no text
    // content, so this is a real assertion on the accessibility constraint,
    // not just presence of the element.
    expect(screen.getByText("New")).toBeTruthy();
  });
});
