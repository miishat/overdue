import { loadEnvConfig } from "@next/env";
import type { Config } from "drizzle-kit";

// drizzle-kit runs outside the Next runtime, so nothing has loaded
// .env.local for it and process.env.DATABASE_URL is undefined. Without this,
// `pnpm db:migrate` fails with "Please provide required params for Postgres
// driver: url: undefined" unless the caller happens to have exported the
// variable into their shell first, which is a step nobody remembers and
// which is not written down anywhere.
//
// @next/env is Next's own officially supported loader for use outside the
// Next runtime. playwright.config.ts already reaches for it for exactly this
// reason; see the comment there.
loadEnvConfig(process.cwd());

if (!process.env.DATABASE_URL) {
  // Fail with the actual problem rather than letting drizzle-kit report a
  // missing url, which reads as a config error rather than a missing
  // environment variable.
  throw new Error(
    "DATABASE_URL is not set. Add it to .env.local, or export it, before running a drizzle-kit command.",
  );
}

export default {
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL },
} satisfies Config;
