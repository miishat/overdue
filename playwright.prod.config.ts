import { loadEnvConfig } from "@next/env";
import { defineConfig } from "@playwright/test";

// Same reasoning as playwright.config.ts: the runner process talks to the
// database directly through tests/e2e/fixtures/seed-states.ts and needs
// DATABASE_URL, which Next only loads for the server process it spawns.
loadEnvConfig(process.cwd());

// Port 3100, not 3000. The dev-mode suite in playwright.config.ts uses 3000
// with reuseExistingServer, so sharing a port would let one suite attach to
// the other's server and silently test the wrong build. That is precisely
// the class of failure that hid the gate bug in M3.
const PORT = 3100;

export default defineConfig({
  testDir: "./tests/e2e-prod",
  // Shares the seeded fixture in tests/e2e/fixtures/seed-states.ts with the
  // dev suite, so the same single-worker rule applies. See the long comment
  // in playwright.config.ts.
  workers: 1,
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    // Builds every run. The service worker is generated at build time
    // (next.config.ts disables Serwist unless NODE_ENV is production), so a
    // stale build would test a stale worker, which is the exact thing this
    // project cannot afford to get wrong quietly. CI pays for the build
    // twice; that is the price of testing what actually ships.
    command: `pnpm build && pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    // Never reuse. A reused server might be a different build entirely.
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      // Same overrides as the dev suite, and the same reasons. See the
      // comments in playwright.config.ts.
      SITE_GATE_SECRET: "",
      CRON_SECRET: "e2e-test-cron-secret-not-a-real-credential",
    },
  },
});
