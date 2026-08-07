// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InstallInstructions } from "./InstallInstructions";

afterEach(cleanup);

describe("InstallInstructions", () => {
  it("gives iOS the exact Share sheet steps, since there is no prompt to offer", () => {
    render(<InstallInstructions platform="ios" />);

    const list = screen.getByRole("list");
    const steps = list.querySelectorAll("li");
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(list.textContent).toContain("Share");
    expect(list.textContent).toContain("Add to Home Screen");
  });

  it("explains why iOS installation matters, not just how", () => {
    render(<InstallInstructions platform="ios" />);

    // The honest reason: on iOS, push only works from the installed app.
    expect(screen.getByText(/notifications/i)).toBeTruthy();
  });

  it("says nothing procedural where the browser offers a button instead", () => {
    render(<InstallInstructions platform="prompt-capable" />);

    expect(screen.queryByText(/Add to Home Screen/i)).toBeNull();
  });

  it("renders nothing at all when already installed", () => {
    const { container } = render(<InstallInstructions platform="installed" />);

    expect(container.innerHTML).toBe("");
  });

  it("says so honestly when this browser has not offered to install the app", () => {
    render(<InstallInstructions platform="unsupported" />);

    expect(screen.getByText(/has not offered/i)).toBeTruthy();
  });
});
