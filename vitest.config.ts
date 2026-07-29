import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
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
