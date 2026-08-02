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
  // 1. Serwist's plugin is webpack only, and Next 16 defaults to Turbopack,
  //    where a webpack config is a hard error. Disabling here lets the dev
  //    server run on Turbopack as Next intends.
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
