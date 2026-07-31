/**
 * Single source of truth for the design palette.
 *
 * `src/app/globals.css` must declare the same hex values under `:root` (dark)
 * and `[data-scheme="light"]` (light). `src/app/globals.test.ts` parses
 * globals.css and asserts it matches PALETTE exactly, so editing one without
 * the other fails a test. `src/lib/contrast.test.ts` imports PALETTE too, so
 * the contrast checks run against the values that actually render.
 */

export type SchemeName = "dark" | "light";

export type TokenName =
  | "ink"
  | "leaf"
  | "rule"
  | "body"
  | "quiet"
  | "verdigris"
  | "oxide";

export const TOKEN_NAMES: readonly TokenName[] = [
  "ink",
  "leaf",
  "rule",
  "body",
  "quiet",
  "verdigris",
  "oxide",
];

export const PALETTE: Record<SchemeName, Record<TokenName, string>> = {
  dark: {
    ink: "#0D0E10",
    leaf: "#16181B",
    rule: "#2B2E33",
    body: "#E6E4DF",
    quiet: "#8A8D93",
    verdigris: "#5F8C7D",
    oxide: "#D99A2B",
  },
  light: {
    ink: "#F2F3F1",
    leaf: "#FFFFFF",
    rule: "#DCDEDA",
    body: "#16181B",
    quiet: "#6B6F73",
    verdigris: "#3F6357",
    oxide: "#8A5A12",
  },
};
