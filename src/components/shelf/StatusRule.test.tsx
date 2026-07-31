// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RELEASE_STATUSES } from "@/db/schema/enums";
import { StatusRule, ruleStyleFor } from "./StatusRule";

afterEach(() => cleanup());

describe("ruleStyleFor", () => {
  it("gives a solid rule to the two confirmed states", () => {
    expect(ruleStyleFor("RELEASED")).toBe("solid");
    expect(ruleStyleFor("DATED")).toBe("solid");
  });

  it("gives a dashed rule to a window", () => {
    expect(ruleStyleFor("ESTIMATED")).toBe("dashed");
  });

  it("gives a dotted rule to the two undated-but-real states", () => {
    expect(ruleStyleFor("ANNOUNCED")).toBe("dotted");
    expect(ruleStyleFor("RUMORED")).toBe("dotted");
  });

  it("gives no rule to the three states with no record", () => {
    expect(ruleStyleFor("EXPECTED")).toBe("none");
    expect(ruleStyleFor("HIATUS")).toBe("none");
    expect(ruleStyleFor("COMPLETE")).toBe("none");
  });

  it("covers every status in the enum, so a ninth state cannot be missed", () => {
    for (const status of RELEASE_STATUSES) {
      expect(["solid", "dashed", "dotted", "none"]).toContain(
        ruleStyleFor(status),
      );
    }
  });
});

describe("StatusRule", () => {
  it("exposes the status as an accessible label, not colour alone", () => {
    render(<StatusRule status="DATED" />);
    expect(screen.getByLabelText("Dated")).toBeTruthy();
  });

  it("renders nothing visible for a state with no rule", () => {
    const { container } = render(<StatusRule status="EXPECTED" />);
    // The element still occupies its grid slot so rows stay aligned, but
    // carries no border.
    const rule = container.querySelector("[data-rule]");
    expect(rule?.getAttribute("data-rule")).toBe("none");
  });

  it("marks RUMORED as dimmed in addition to dotted", () => {
    const { container } = render(<StatusRule status="RUMORED" />);
    const rule = container.querySelector("[data-rule]");
    expect(rule?.getAttribute("data-rule")).toBe("dotted");
    expect(rule?.getAttribute("data-dimmed")).toBe("true");
  });

  it("does not mark ANNOUNCED as dimmed, which is what separates it from RUMORED", () => {
    const { container } = render(<StatusRule status="ANNOUNCED" />);
    const rule = container.querySelector("[data-rule]");
    expect(rule?.getAttribute("data-dimmed")).toBeNull();
  });

  it("gives every status a distinct accessible label", () => {
    const labels = new Set<string>();
    for (const status of RELEASE_STATUSES) {
      const { container, unmount } = render(<StatusRule status={status} />);
      const label = container
        .querySelector("[data-rule]")
        ?.getAttribute("aria-label");
      expect(label).toBeTruthy();
      labels.add(label as string);
      unmount();
    }
    expect(labels.size).toBe(RELEASE_STATUSES.length);
  });
});
