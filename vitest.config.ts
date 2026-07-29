import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // *.live.test.ts files make real network calls (see hardcover.live.test.ts)
    // and must never run as part of the default suite or in CI.
    exclude: ["**/*.live.test.ts", "**/node_modules/**", "**/.next/**"],
    setupFiles: ["tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // See tests/stubs/next-font-google.ts for why this alias exists.
      "next/font/google": path.resolve(
        __dirname,
        "tests/stubs/next-font-google.ts",
      ),
    },
  },
});
