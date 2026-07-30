import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  path.resolve(__dirname, "globals.css"),
  "utf8",
);

const TOKENS = [
  "ink",
  "leaf",
  "rule",
  "body",
  "quiet",
  "verdigris",
  "oxide",
] as const;

const DARK: Record<string, string> = {
  ink: "#0D0E10",
  leaf: "#16181B",
  rule: "#2B2E33",
  body: "#E6E4DF",
  quiet: "#8A8D93",
  verdigris: "#5F8C7D",
  oxide: "#D99A2B",
};

const LIGHT: Record<string, string> = {
  ink: "#F2F3F1",
  leaf: "#FFFFFF",
  rule: "#DCDEDA",
  body: "#16181B",
  quiet: "#6B6F73",
  verdigris: "#3F6357",
  oxide: "#8A5A12",
};

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
    for (const token of TOKENS) {
      expect(block).toContain(`--${token}: ${DARK[token]}`);
    }
  });

  it("defines every token in the light scheme with the spec's value", () => {
    const block = lightBlock();
    for (const token of TOKENS) {
      expect(block).toContain(`--${token}: ${LIGHT[token]}`);
    }
  });

  it("carries no leftover scaffold tokens", () => {
    expect(css).not.toContain("geist");
    expect(css).not.toContain("--background");
    expect(css).not.toContain("--foreground");
  });

  it("exposes the three loaded font families as tokens", () => {
    expect(css).toContain("--font-display");
    expect(css).toContain("--font-ui");
    expect(css).toContain("--font-mono");
  });
});
