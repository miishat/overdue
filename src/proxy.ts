import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { evaluateGate } from "@/lib/gate";

export const GATE_COOKIE_NAME = "overdue_gate";
export const GATE_QUERY_PARAM = "gate";

export function proxy(request: NextRequest) {
  const secret = process.env.SITE_GATE_SECRET;
  const cookieValue = request.cookies.get(GATE_COOKIE_NAME)?.value;
  const suppliedSecret = request.nextUrl.searchParams.get(GATE_QUERY_PARAM);

  const decision = evaluateGate({ secret, cookieValue, suppliedSecret });

  switch (decision.kind) {
    case "allow":
      return NextResponse.next();

    case "unlock": {
      // evaluateGate only returns "unlock" when secret is a defined,
      // non-empty string, so this narrows safely without a type assertion.
      // This branch is unreachable today, but this file's entire job is
      // denial, so the unreachable default denies rather than admits.
      if (!secret) {
        return denyResponse();
      }

      const redirectUrl = new URL(request.nextUrl);
      redirectUrl.searchParams.delete(GATE_QUERY_PARAM);

      const response = NextResponse.redirect(redirectUrl);
      response.cookies.set(GATE_COOKIE_NAME, secret, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 365,
      });
      return response;
    }

    case "deny":
      return denyResponse();
  }
}

function denyResponse(): NextResponse {
  return new NextResponse("Not available.", {
    status: 401,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

// manifest.webmanifest is excluded from the gate on purpose. A
// <link rel="manifest"> is fetched with credentials omitted unless the tag
// carries crossorigin="use-credentials", which Next only emits on Vercel
// preview deployments, so in production the manifest is always fetched
// anonymously. Gating it would 401 the manifest, iOS would never see
// display: standalone, and Add to Home Screen (and therefore iOS push)
// would be impossible. The manifest only exposes the app name, colours,
// and icon paths, which is less than the favicon and static assets already
// excluded below.
//
// The icons the manifest points at must be excluded for the same reason,
// and leaving them gated made the manifest exclusion useless: verified
// against the live deployment, manifest.webmanifest returned 200 while
// every icon it references returned 401. Install machinery fetches those
// icons out of band, without the gate cookie, so Add to Home Screen read
// a valid manifest and then could not load a single icon. The icon paths
// are already public knowledge, because the manifest lists them.
//
// /sw.js stays gated: it is fetched with credentials same-origin, so the
// cookie is sent and it registers fine for an unlocked user.
export const config = {
  matcher: [
    // The icon rule is anchored with $ deliberately. Without it the lookahead
    // matches on prefix, so any path merely BEGINNING with an icon name, such
    // as /icon-192.png/anything, would be ungated too.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon-[^/]*\\.png$).*)",
  ],
};
