import { defineConfig } from "vitest/config";
import path from "node:path";

// Separate config for live tests (see hardcover.live.test.ts): these make
// real network calls, so they must NOT share vitest.config.ts's setupFiles,
// which starts an MSW server configured to error on any unhandled request.
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.live.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
