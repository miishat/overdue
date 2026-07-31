import { loadEnvConfig } from "@next/env";
import { defineConfig } from "@playwright/test";

// The Playwright test-runner process does not get .env.local the way the
// spawned `pnpm dev` webServer does (Next loads it internally for that
// child process only). tests/e2e/fixtures/seed-states.ts talks to the
// database directly from the runner process, so it needs the same
// DATABASE_URL. @next/env is Next's own, officially supported loader for
// use outside the Next runtime, so it is used here rather than a hand
// rolled .env parser.
loadEnvConfig(process.cwd());

export default defineConfig({
  testDir: "./tests/e2e",
  // Several specs (waiting-shelf.spec.ts, navigation.spec.ts) seed and clear
  // a shared set of fixed ids in tests/e2e/fixtures/seed-states.ts against
  // the developer's live database. Two spec files doing that concurrently
  // in different workers causes duplicate-key errors on insert and lets one
  // file's cleanup delete rows the other file's still-running test depends
  // on, an intermittent failure that is genuinely unpleasant to diagnose.
  // Forcing a single worker makes spec files run one at a time so the
  // shared fixture is never touched by two files simultaneously. Do not
  // remove this to "parallelise" the suite without first giving the shared
  // fixture real concurrency safety (e.g. per-file id namespacing or
  // cross-process locking).
  workers: 1,
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
    // next dev loads .env.local, which carries a live SITE_GATE_SECRET on
    // the owner's machine. Without this override every e2e spec would get
    // a 401 from src/proxy.ts on its first page.goto("/"). Next does not
    // let .env.local override an already-defined process.env key, and
    // evaluateGate treats "" as allow, so this disables the gate for the
    // server Playwright starts.
    //
    // Known limitation: reuseExistingServer:true means that if a gated
    // pnpm dev is already running on port 3000, Playwright attaches to
    // that server instead of starting its own, and the suite still fails
    // with 401s. The owner must stop any already-running dev server
    // before running the e2e suite.
    env: { SITE_GATE_SECRET: "" },
  },
});
