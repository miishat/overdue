/**
 * Live smoke test against the real Wikidata APIs (wbsearchentities and the
 * SPARQL query service).
 *
 * This file intentionally makes real network calls and is NOT part of the
 * default `pnpm test` run (see vitest.config.ts's `exclude`) or CI, per the
 * project rule that CI never makes live network calls. Run it manually with
 * `pnpm test:live`.
 *
 * This guards against the specific failure mode that shipped undetected
 * before: searchBooks scanning the whole graph via wdt:P31/wdt:P279* and
 * timing out. The assertion on elapsed time is the regression check.
 */
import { describe, expect, it } from "vitest";
import { PROVIDER_TIMEOUT_MS } from "./registry";
import { wikidataProvider } from "./wikidata";

describe("wikidataProvider (live)", () => {
  it("returns real results for a known query, well under the provider timeout", async () => {
    const start = Date.now();
    const results = await wikidataProvider.searchBooks("the way of kings");
    const elapsedMs = Date.now() - start;

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toMatchObject({ provider: "wikidata" });
    expect(typeof results[0].title).toBe("string");
    expect(results[0].title.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(PROVIDER_TIMEOUT_MS);
  });

  it("getSeriesEntries still answers quickly for a known series", async () => {
    const start = Date.now();
    const entries = await wikidataProvider.getSeriesEntries("Q45875");
    const elapsedMs = Date.now() - start;

    expect(entries.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(PROVIDER_TIMEOUT_MS);
  });
});
