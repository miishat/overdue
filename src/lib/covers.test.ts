import { describe, expect, it } from "vitest";
import { coverProxyPath, coverSrcFor, isSafeCoverUrl } from "./covers";

describe("isSafeCoverUrl", () => {
  it("accepts an https url on a public host", () => {
    expect(isSafeCoverUrl("https://covers.openlibrary.org/b/id/8231856-L.jpg")).toBe(true);
  });

  it("rejects null and undefined and the empty string", () => {
    expect(isSafeCoverUrl(null)).toBe(false);
    expect(isSafeCoverUrl(undefined)).toBe(false);
    expect(isSafeCoverUrl("")).toBe(false);
  });

  it("rejects anything that is not https", () => {
    expect(isSafeCoverUrl("http://covers.openlibrary.org/x.jpg")).toBe(false);
    expect(isSafeCoverUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeCoverUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isSafeCoverUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects a url that is not a url at all", () => {
    expect(isSafeCoverUrl("not a url")).toBe(false);
    expect(isSafeCoverUrl("/relative/path.jpg")).toBe(false);
  });

  it("rejects embedded credentials, which would leak into the outbound request", () => {
    expect(isSafeCoverUrl("https://user:pass@covers.openlibrary.org/x.jpg")).toBe(false);
    expect(isSafeCoverUrl("https://user@covers.openlibrary.org/x.jpg")).toBe(false);
  });

  it("rejects a url with an explicit port, which shapes a port-scan probe", () => {
    expect(isSafeCoverUrl("https://covers.openlibrary.org:8443/x.jpg")).toBe(false);
    expect(isSafeCoverUrl("https://public-name.example:8443/")).toBe(false);
  });

  it("rejects loopback and link-local and private names", () => {
    expect(isSafeCoverUrl("https://localhost/x.jpg")).toBe(false);
    expect(isSafeCoverUrl("https://LOCALHOST/x.jpg")).toBe(false);
    expect(isSafeCoverUrl("https://myservice.local/x.jpg")).toBe(false);
    expect(isSafeCoverUrl("https://db.internal/x.jpg")).toBe(false);
    expect(isSafeCoverUrl("https://box.localhost/x.jpg")).toBe(false);
  });

  it("rejects literal IP addresses, public or not", () => {
    // No legitimate book cover is served from a bare IP, and allowing any of
    // them means re-implementing the private-range tables here and getting
    // them subtly wrong. Refusing all literals is the smaller rule.
    expect(isSafeCoverUrl("https://127.0.0.1/x.jpg")).toBe(false);
    expect(isSafeCoverUrl("https://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isSafeCoverUrl("https://10.0.0.5/x.jpg")).toBe(false);
    expect(isSafeCoverUrl("https://8.8.8.8/x.jpg")).toBe(false);
    expect(isSafeCoverUrl("https://[::1]/x.jpg")).toBe(false);
    expect(isSafeCoverUrl("https://[fd00::1]/x.jpg")).toBe(false);
  });

  it("rejects a host with no dot, which cannot be a public name", () => {
    expect(isSafeCoverUrl("https://intranet/x.jpg")).toBe(false);
  });

  it("rejects a hostname ending in a dot, which defeats the private-host and single-label rules", () => {
    // A trailing dot in WHATWG URL parsing is preserved in url.hostname, but
    // DNS treats "localhost." and "localhost" identically. This must not walk
    // past the exact-match, suffix-match, or single-label rules.
    expect(isSafeCoverUrl("https://localhost./x.jpg")).toBe(false);
    expect(isSafeCoverUrl("https://db.internal./x.jpg")).toBe(false);
    expect(isSafeCoverUrl("https://myservice.local./x.jpg")).toBe(false);
    expect(isSafeCoverUrl("https://box.localhost./x.jpg")).toBe(false);
    expect(isSafeCoverUrl("https://intranet./x.jpg")).toBe(false);
  });
});

describe("coverProxyPath", () => {
  it("builds a same-origin path from a book id", () => {
    expect(coverProxyPath("11111111-2222-3333-4444-555555555555")).toBe(
      "/api/covers/11111111-2222-3333-4444-555555555555",
    );
  });

  it("encodes the id rather than interpolating it raw", () => {
    expect(coverProxyPath("a/../b")).toBe("/api/covers/a%2F..%2Fb");
  });
});

describe("coverSrcFor", () => {
  const bookId = "11111111-2222-3333-4444-555555555555";

  it("returns the proxy path when there is a book row and a usable cover", () => {
    expect(
      coverSrcFor({ bookId, coverUrl: "https://covers.openlibrary.org/b/id/1-L.jpg" }),
    ).toBe(`/api/covers/${bookId}`);
  });

  it("returns null when there is no cover, so the caller renders a Gap", () => {
    expect(coverSrcFor({ bookId, coverUrl: null })).toBeNull();
  });

  it("returns null when there is no book row, because the proxy is keyed by book id", () => {
    expect(
      coverSrcFor({ bookId: null, coverUrl: "https://covers.openlibrary.org/b/id/1-L.jpg" }),
    ).toBeNull();
  });

  it("returns null for a stored cover url the proxy would refuse anyway", () => {
    expect(coverSrcFor({ bookId, coverUrl: "http://covers.openlibrary.org/b/id/1-L.jpg" }))
      .toBeNull();
  });
});
