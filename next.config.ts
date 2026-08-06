import { execSync } from "node:child_process";
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
// The revision must change on every deploy, not just when this file's own
// source changes. The prerendered /offline HTML references content-hashed
// build assets (_next/static/chunks/webpack-<hash>.js,
// _next/static/chunks/main-app-<hash>.js, _next/static/css/<hash>.css), and
// those hashes change on essentially every deploy because the webpack
// runtime chunk changes whenever any chunk does. On activation, Workbox
// deletes precache entries that are no longer in the manifest, so the old
// chunks and CSS get evicted. If /offline keeps an identical revision, it is
// not re-fetched, and the installed worker is left serving offline HTML
// whose stylesheet and scripts exist neither in the precache nor on the
// server: the offline page renders unstyled and never hydrates, on the one
// page whose entire job is to look composed when everything else has
// failed. So the revision is a commit SHA, not a hash of the page's own
// source: VERCEL_GIT_COMMIT_SHA when Vercel provides one, otherwise the
// local git HEAD. A timestamp was considered and rejected for the same
// reason as before: next.config.ts can be evaluated more than once during a
// single build, and Date.now() would differ between those evaluations,
// producing mismatched manifests within one build. A commit SHA does not
// have that problem, because it is identical across every evaluation that
// happens against the same commit and only changes when a new commit does,
// which is exactly the "stable within a build, different across builds"
// behaviour this needs. The content hash remains as a last-resort fallback,
// for a build with no git directory at all, such as one from a tarball.
function resolveOfflineRevision(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 16);
  }

  try {
    const sha = execSync("git rev-parse HEAD").toString().trim();
    if (sha !== "") return sha.slice(0, 16);
  } catch {
    // No git directory available, e.g. a build from a source tarball.
  }

  return createHash("sha256")
    .update(readFileSync("src/app/offline/page.tsx"))
    .digest("hex")
    .slice(0, 16);
}

const offlineRevision = resolveOfflineRevision();

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
