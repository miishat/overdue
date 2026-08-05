import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const nextConfig: NextConfig = {
  /* config options here */
};

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
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
