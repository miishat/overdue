/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProvenanceStamp } from "./ProvenanceStamp";

afterEach(() => cleanup());

const NOW = new Date("2026-07-30T00:00:00Z");

describe("ProvenanceStamp", () => {
  it("renders the formatStamp output", () => {
    render(
      <ProvenanceStamp
        provider="wikidata"
        lastVerifiedAt={new Date("2026-07-24T00:00:00Z")}
        now={NOW}
      />,
    );
    expect(screen.getByText("WIKIDATA · CHK 6d")).toBeTruthy();
  });

  it("renders a later move in the oxide token", () => {
    const { container } = render(
      <ProvenanceStamp
        provider="wikidata"
        lastVerifiedAt={new Date("2026-07-24T00:00:00Z")}
        now={NOW}
        move={{ label: "MOVED +3W", direction: "later" }}
      />,
    );
    expect(screen.getByText("MOVED +3W")).toBeTruthy();
    const el = container.querySelector('[data-move-token="oxide"]');
    expect(el).toBeTruthy();
    // Pin the actual class, not just the test-only data attribute: the
    // colour the user sees comes from className, so the attribute alone
    // could desync from it and this test would still pass.
    expect(el?.className).toContain("text-oxide");
    expect(el?.className).not.toContain("text-verdigris");
  });

  it("renders an earlier move in the verdigris token", () => {
    const { container } = render(
      <ProvenanceStamp
        provider="wikidata"
        lastVerifiedAt={new Date("2026-07-24T00:00:00Z")}
        now={NOW}
        move={{ label: "MOVED -2W", direction: "earlier" }}
      />,
    );
    expect(screen.getByText("MOVED -2W")).toBeTruthy();
    const el = container.querySelector('[data-move-token="verdigris"]');
    expect(el).toBeTruthy();
    expect(el?.className).toContain("text-verdigris");
    expect(el?.className).not.toContain("text-oxide");
  });

  it("renders the stamp in the mono font", () => {
    const { container } = render(
      <ProvenanceStamp
        provider="wikidata"
        lastVerifiedAt={new Date("2026-07-24T00:00:00Z")}
        now={NOW}
      />,
    );
    const stamp = container.querySelector("[data-provenance-stamp]");
    expect(stamp?.className).toContain("font-mono");
  });
});
