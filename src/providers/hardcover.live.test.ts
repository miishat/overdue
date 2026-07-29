/**
 * Live smoke test against the real Hardcover API.
 *
 * This file intentionally makes a real network call and is NOT part of the
 * default `pnpm test` run (see vitest.config.ts's `exclude`) or CI, per the
 * project rule that CI never makes live network calls. Run it manually with
 * `pnpm test:live`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { hardcoverProvider } from "./hardcover";

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;

  const contents = readFileSync(envPath, "utf8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");

    if (!(key in process.env)) process.env[key] = value;
  }
}

beforeAll(() => {
  loadEnvLocal();
});

describe("hardcoverProvider (live)", () => {
  it("returns real results for a known query", async () => {
    if (!process.env.HARDCOVER_API_TOKEN) {
      throw new Error(
        "HARDCOVER_API_TOKEN is not set; add it to .env.local to run live tests.",
      );
    }

    const results = await hardcoverProvider.searchBooks("mistborn");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toMatchObject({ provider: "hardcover" });
    expect(typeof results[0].title).toBe("string");
    expect(results[0].title.length).toBeGreaterThan(0);
  });
});
