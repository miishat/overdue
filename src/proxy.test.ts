import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
// The brief refers to this helper as `unstable_doesProxyMatch`, but the
// installed Next 16.2.12 package still exports it under its pre-rename name,
// `unstable_doesMiddlewareMatch`. Same behavior, older name.
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { GATE_COOKIE_NAME, GATE_QUERY_PARAM, config, proxy } from "./proxy";

const SECRET = "test-only-fake-secret-value";

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
}

beforeEach(() => {
  resetEnv();
});

afterEach(() => {
  resetEnv();
});

describe("proxy matcher", () => {
  it("covers /api/search", () => {
    expect(unstable_doesMiddlewareMatch({ config, url: "/api/search" })).toBe(
      true,
    );
  });

  it("does not cover /_next/static/chunk.js", () => {
    expect(
      unstable_doesMiddlewareMatch({ config, url: "/_next/static/chunk.js" }),
    ).toBe(false);
  });

  // Regression protection: a matcher narrowed to something like
  // '/api/:path*' would keep the two assertions above green while silently
  // ungating every page, leaving the UI publicly reachable with the suite
  // passing. These two assert the gate still covers the app itself.
  it("covers /", () => {
    expect(unstable_doesMiddlewareMatch({ config, url: "/" })).toBe(true);
  });

  it("covers a non-API page path", () => {
    expect(unstable_doesMiddlewareMatch({ config, url: "/library" })).toBe(
      true,
    );
  });

  // manifest.webmanifest must stay reachable without the gate cookie, or
  // iOS never sees display: standalone and Add to Home Screen is
  // impossible, which in turn makes iOS push impossible.
  it("does not cover /manifest.webmanifest", () => {
    expect(
      unstable_doesMiddlewareMatch({ config, url: "/manifest.webmanifest" }),
    ).toBe(false);
  });

  // The icons the manifest references must be reachable without the gate
  // cookie too. Excluding the manifest alone was useless: verified against
  // the live deployment, manifest.webmanifest returned 200 while all three
  // icons returned 401, so install read a valid manifest and then could not
  // fetch a single icon.
  it.each(["/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"])(
    "does not cover %s, which the manifest references",
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
    },
  );

  // The exclusion is scoped to the icons at the root that the manifest
  // names. It must not become a hole any path can slip through by ending
  // in .png, which would ungate a route whose name merely looked like one.
  it.each([
    "/books/icon-192.png",
    "/api/icon-192.png",
    "/icon-192.png/secret",
  ])("still covers %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
  });

  // The scheduled job calls /api/refresh from GitHub Actions, which has no
  // gate cookie. Gating it meant the cron got this file's 401 and never
  // reached the route. The route carries its own stronger bearer check.
  it("does not cover /api/refresh", () => {
    expect(unstable_doesMiddlewareMatch({ config, url: "/api/refresh" })).toBe(
      false,
    );
  });

  // The exclusion is exactly one route, not the API surface. /api/search
  // proxies a rate-limited third-party token and there is no auth in v1, so
  // an exclusion that widened to /api would hand that token to anyone.
  it.each([
    "/api/search",
    "/api/track",
    "/api/manual",
    "/api/read-state",
    "/api/push/subscribe",
    "/api/push/unsubscribe",
    "/api/shelf/viewed",
    "/api/refresh/extra",
  ])("still covers %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
  });

  // /sw.js must stay gated: it is fetched with credentials same-origin, so
  // an unlocked user's cookie is sent and it registers fine.
  it("covers /sw.js", () => {
    expect(unstable_doesMiddlewareMatch({ config, url: "/sw.js" })).toBe(
      true,
    );
  });
});

describe("proxy", () => {
  it("passes through when SITE_GATE_SECRET is unset", () => {
    delete process.env.SITE_GATE_SECRET;

    const request = new NextRequest("https://example.com/api/search");
    const response = proxy(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("denies with 401 and exact plain-text body when no secret is supplied", () => {
    process.env.SITE_GATE_SECRET = SECRET;

    const request = new NextRequest("https://example.com/api/search");
    const response = proxy(request);

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
  });

  it("denies matches the exact body text", async () => {
    process.env.SITE_GATE_SECRET = SECRET;

    const request = new NextRequest("https://example.com/api/search");
    const response = proxy(request);

    await expect(response.text()).resolves.toBe("Not available.");
  });

  it("denies with Cache-Control: no-store", () => {
    process.env.SITE_GATE_SECRET = SECRET;

    const request = new NextRequest("https://example.com/api/search");
    const response = proxy(request);

    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("unlocks and redirects with the gate param stripped when the query secret matches", () => {
    process.env.SITE_GATE_SECRET = SECRET;

    const request = new NextRequest(
      `https://example.com/library?${GATE_QUERY_PARAM}=${SECRET}&foo=bar`,
    );
    const response = proxy(request);

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") as string);
    expect(location.searchParams.get(GATE_QUERY_PARAM)).toBeNull();
    expect(location.searchParams.get("foo")).toBe("bar");
    expect(location.pathname).toBe("/library");
  });

  it("sets the gate cookie with the expected attributes on unlock", () => {
    process.env.SITE_GATE_SECRET = SECRET;

    const request = new NextRequest(
      `https://example.com/library?${GATE_QUERY_PARAM}=${SECRET}`,
    );
    const response = proxy(request);

    const setCookie = response.headers.get("set-cookie") as string;
    expect(setCookie).toContain(`${GATE_COOKIE_NAME}=${SECRET}`);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain(`Max-Age=${60 * 60 * 24 * 365}`);
  });

  it("marks the gate cookie Secure in production", () => {
    process.env.SITE_GATE_SECRET = SECRET;
    process.env.NODE_ENV = "production";

    const request = new NextRequest(
      `https://example.com/library?${GATE_QUERY_PARAM}=${SECRET}`,
    );
    const response = proxy(request);

    const setCookie = response.headers.get("set-cookie") as string;
    expect(setCookie.toLowerCase()).toContain("secure");
  });

  it("allows through when the cookie already carries the correct secret", () => {
    process.env.SITE_GATE_SECRET = SECRET;

    const request = new NextRequest("https://example.com/api/search", {
      headers: { cookie: `${GATE_COOKIE_NAME}=${SECRET}` },
    });
    const response = proxy(request);

    expect(response.status).toBe(200);
  });
});
