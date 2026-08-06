/**
 * Pure rules for serving book covers from our own origin.
 *
 * The proxy route is keyed by book id, never by a caller-supplied URL, so
 * there is no path by which an anonymous request can make our server fetch
 * an address of its choosing. This module is the second layer: it decides
 * whether a URL we already stored is one we are willing to fetch.
 *
 * It is deliberately not a host allowlist. Provider CDN hostnames change
 * without notice, and a stale list fails silently, which is the worst
 * available failure mode for an image: covers just stop appearing and
 * nothing logs anything. The rules below constrain the shape of the address
 * instead, which is what actually closes the request-forgery class.
 */

// Hostnames that name something only the server can reach. Checked as exact
// matches and as suffixes, so "box.localhost" is refused along with
// "localhost" itself.
const PRIVATE_SUFFIXES = ["localhost", "local", "internal", "home.arpa"];

function isIpLiteral(hostname: string): boolean {
  // URL normalises an IPv6 host to bracketed form, so this covers ::1,
  // fd00::/8 and every other v6 literal in one check.
  if (hostname.startsWith("[")) return true;
  // IPv4 dotted quad. Anything all-digits-and-dots is treated as a literal
  // rather than parsed, because a partial parse is how these checks get
  // bypassed (0x7f.1, 2130706433, and friends).
  return /^[0-9.]+$/.test(hostname);
}

export function isSafeCoverUrl(value: string | null | undefined): value is string {
  if (typeof value !== "string" || value === "") return false;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;

  // Credentials in the URL would be sent on the outbound request and could
  // end up in a log or an error message. Nothing legitimate needs them.
  if (url.username !== "" || url.password !== "") return false;

  const hostname = url.hostname.toLowerCase();
  if (hostname === "") return false;
  if (isIpLiteral(hostname)) return false;

  for (const suffix of PRIVATE_SUFFIXES) {
    if (hostname === suffix || hostname.endsWith(`.${suffix}`)) return false;
  }

  // A single-label host cannot be a public name. This is what catches
  // "https://intranet/logo.jpg" on a corporate network.
  if (!hostname.includes(".")) return false;

  return true;
}

export function coverProxyPath(bookId: string): string {
  return `/api/covers/${encodeURIComponent(bookId)}`;
}

/**
 * The src to render for one entry, or null to render a Gap instead.
 *
 * Returns null for a synthetic entry (no bookId), because the proxy is keyed
 * by book id and there is nothing to key on. Callers already render a Gap in
 * that case; see ShelfRow's showGap.
 */
export function coverSrcFor(entry: {
  bookId: string | null;
  coverUrl: string | null;
}): string | null {
  if (entry.bookId === null) return null;
  if (!isSafeCoverUrl(entry.coverUrl)) return null;
  return coverProxyPath(entry.bookId);
}
