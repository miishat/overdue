import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { books } from "@/db/schema/catalog";
import { isSafeCoverUrl } from "@/lib/covers";

// Reads the database on every request, so it must never be statically
// evaluated at build time. Same reasoning as every other db-reading route.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UPSTREAM_TIMEOUT_MS = 6000;

// One day at the HTTP layer. The service worker holds covers for far longer
// than this (see src/sw.ts), which is what makes them available offline; this
// header is what lets a genuinely changed cover eventually win, since the
// proxy path is keyed by book id and would otherwise be permanently frozen
// on the first image we ever served for that book.
const CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";

function notFound(): Response {
  return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
}

function badGateway(): Response {
  // Deliberately not 404: 404 is cacheable-shaped and means "this book has no
  // cover", which is a different and more permanent fact than "the provider
  // was unreachable just now".
  return new Response(null, { status: 502, headers: { "cache-control": "no-store" } });
}

/**
 * Serves a tracked book's cover from our own origin.
 *
 * Keyed by book id, never by a caller-supplied URL. That is the whole point:
 * with no authentication in v1, a url-taking proxy would be an anonymous
 * server-side request forgery primitive. Here the only thing a caller
 * controls is which of our own books to ask about.
 *
 * Nothing about the upstream response is passed through except the body and
 * a content type we have checked, so a provider cannot set a cookie, a CORS
 * header, or a redirect on our origin.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ bookId: string }> },
): Promise<Response> {
  const { bookId } = await context.params;

  // Postgres raises on a malformed uuid, so this is a correctness guard as
  // well as a way to keep junk requests off the database.
  if (!UUID.test(bookId)) {
    return new Response(null, { status: 400, headers: { "cache-control": "no-store" } });
  }

  const found = await db
    .select({ coverUrl: books.coverUrl })
    .from(books)
    .where(eq(books.id, bookId));

  const coverUrl = found[0]?.coverUrl ?? null;
  if (!isSafeCoverUrl(coverUrl)) {
    return notFound();
  }

  let upstream: Response;
  try {
    upstream = await fetch(coverUrl, {
      // Never follow a redirect off the address we checked. A provider that
      // 302s to somewhere else would otherwise walk straight past
      // isSafeCoverUrl.
      redirect: "error",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: { accept: "image/*" },
    });
  } catch {
    return badGateway();
  }

  if (!upstream.ok || upstream.body === null) {
    return badGateway();
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    return badGateway();
  }

  // A fresh Headers object rather than upstream.headers, so nothing the
  // provider sets reaches the browser on our origin.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": CACHE_CONTROL,
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
    },
  });
}
