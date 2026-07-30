import { describe, expect, it } from "vitest";
import { PALETTE, TOKEN_NAMES } from "./tokens";

describe("PALETTE", () => {
  it("defines every token in both schemes", () => {
    for (const scheme of ["dark", "light"] as const) {
      for (const token of TOKEN_NAMES) {
        expect(PALETTE[scheme][token]).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });

  it("lists exactly the seven tokens the spec defines", () => {
    expect([...TOKEN_NAMES]).toEqual([
      "ink",
      "leaf",
      "rule",
      "body",
      "quiet",
      "verdigris",
      "oxide",
    ]);
  });

  it("carries the approved dark values", () => {
    expect(PALETTE.dark).toEqual({
      ink: "#0D0E10",
      leaf: "#16181B",
      rule: "#2B2E33",
      body: "#E6E4DF",
      quiet: "#8A8D93",
      verdigris: "#5F8C7D",
      oxide: "#D99A2B",
    });
  });

  it("carries the approved light values", () => {
    expect(PALETTE.light).toEqual({
      ink: "#F2F3F1",
      leaf: "#FFFFFF",
      rule: "#DCDEDA",
      body: "#16181B",
      quiet: "#6B6F73",
      verdigris: "#3F6357",
      oxide: "#8A5A12",
    });
  });

  it("uses uppercase hex consistently, so CSS comparison is exact", () => {
    for (const scheme of ["dark", "light"] as const) {
      for (const token of TOKEN_NAMES) {
        const value = PALETTE[scheme][token];
        expect(value).toBe(value.toUpperCase());
      }
    }
  });
});
