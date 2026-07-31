import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PALETTE, TOKEN_NAMES } from "@/lib/tokens";

const css = readFileSync(
  path.resolve(__dirname, "globals.css"),
  "utf8",
);

/** Everything inside :root, which is the dark scheme because dark is default. */
function darkBlock(): string {
  const match = css.match(/:root\s*\{([^}]*)\}/);
  if (!match) throw new Error("no :root block found in globals.css");
  return match[1];
}

/** Everything inside the light-scheme override block. */
function lightBlock(): string {
  const match = css.match(/\[data-scheme="light"\]\s*\{([^}]*)\}/);
  if (!match) throw new Error('no [data-scheme="light"] block found');
  return match[1];
}

describe("design tokens", () => {
  it("defines every token in the dark scheme with the spec's value", () => {
    const block = darkBlock();
    for (const token of TOKEN_NAMES) {
      expect(block).toContain(`--${token}: ${PALETTE.dark[token]}`);
    }
  });

  it("defines every token in the light scheme with the spec's value", () => {
    const block = lightBlock();
    for (const token of TOKEN_NAMES) {
      expect(block).toContain(`--${token}: ${PALETTE.light[token]}`);
    }
  });

  it("declares every token value from tokens.ts, so the CSS cannot drift", () => {
    for (const token of TOKEN_NAMES) {
      expect(darkBlock()).toContain(`--${token}: ${PALETTE.dark[token]}`);
      expect(lightBlock()).toContain(`--${token}: ${PALETTE.light[token]}`);
    }
  });

  it("carries no leftover scaffold tokens", () => {
    expect(css).not.toContain("geist");
    expect(css).not.toContain("--background");
    expect(css).not.toContain("--foreground");
  });

  // --font-mono is deliberately not aliased here: next/font declares
  // --font-mono directly in src/lib/fonts.ts, so an alias of --font-mono to
  // itself would be self-referential and resolve to nothing. Only the
  // display and UI faces get role-name aliases, so those are what this test
  // checks are actually declared (not just mentioned in a comment).
  it("declares the display and UI font aliases", () => {
    expect(css).toContain("--font-display: var(--font-newsreader)");
    expect(css).toContain("--font-ui: var(--font-instrument)");
  });
});
