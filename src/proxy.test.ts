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

  it("allows through when the cookie already carries the correct secret", () => {
    process.env.SITE_GATE_SECRET = SECRET;

    const request = new NextRequest("https://example.com/api/search", {
      headers: { cookie: `${GATE_COOKIE_NAME}=${SECRET}` },
    });
    const response = proxy(request);

    expect(response.status).toBe(200);
  });
});
