import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
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
