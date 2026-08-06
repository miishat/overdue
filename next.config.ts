import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const nextConfig: NextConfig = {
  /* config options here */
};

// Serwist's injected manifest covers public/ and _next/static. It does not
// cover App Router routes, so the offline fallback has to be added by hand.
// Verified in node_modules/.pnpm/@serwist+build@9.5.12_*/node_modules/
// @serwist/build/dist/index.d.mts, where GetManifestOptions declares
// additionalPrecacheEntries?: (string | ManifestEntry)[].
//
// The revision is a hash of the page's own source rather than a build id or
// a timestamp. next.config.ts can be evaluated more than once during a
// single build, and a value that changes between evaluations would produce
// mismatched manifests; a content hash is stable within a build and changes
// when the page changes.
//
// Known limitation, accepted: this does not change when globals.css or the
// root layout changes, so a restyled offline page can stay stale in an
// already-installed worker until the next time this file changes. The page
// is a static "you are offline" message shown only when the network is gone,
// so the cost of that staleness is close to zero.
const offlineRevision = createHash("sha256")
  .update(readFileSync("src/app/offline/page.tsx"))
  .digest("hex")
  .slice(0, 16);

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  additionalPrecacheEntries: [{ url: "/offline", revision: offlineRevision }],
  // Disabled in development, which is Serwist's own first recommendation for
  // this setup. Two reasons, and the second is not obvious:
  //
  // 1. This does NOT let the dev server run on Turbopack. Serwist's plugin
  //    (node_modules/@serwist/next/dist/index.mjs) always returns
  //    { ...nextConfig, webpack(config, options) {...} }; the webpack key
  //    is present unconditionally, and `disable` is only consulted inside
  //    that function body, not around it. So Next 16's Turbopack hard
  //    error on a webpack config would still fire regardless of this flag.
  //    What actually lets `pnpm dev` run is `--webpack` in package.json,
  //    which opts the whole dev server into webpack instead of Turbopack.
  // 2. A registered service worker CONTROLS the page and intercepts fetches
  //    before Playwright's page.route can see them, which silently broke the
  //    e2e spec asserting that a settled query fires exactly one search
  //    request. It observed zero, because the worker served the request.
  //
  // The cost: push cannot be exercised with `pnpm dev`. It needs
  // `pnpm build && pnpm start`, where the worker is real.
  disable: process.env.NODE_ENV !== "production",
});

export default withSerwist(nextConfig);
