import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { evaluateGate } from "@/lib/gate";

export const GATE_COOKIE_NAME = "overdue_gate";
export const GATE_QUERY_PARAM = "gate";

// evaluateGate (src/lib/gate.ts) allows every request through when
// SITE_GATE_SECRET is unset or blank. That default is correct for local
// development, where nobody should need an env var just to run `pnpm dev`.
// It also means a production deploy that forgot to set the variable is
// fully open, silently. The project owner's call (E2 in
// docs/audits/2026-07-30-full-audit.md) is to warn loudly rather than fail
// closed: a forgotten variable must not take the whole site down. This
// lives here, not in gate.ts, because gate.ts is documented pure decision
// logic with no environment reads and no next/* imports, and evaluateGate's
// own return contract is unchanged by this.
//
// The flag is module-scope so the warning fires once per process rather
// than once per request. A per-request warning was the simpler option, but
// production traffic would turn one missing env var into a continuous
// scroll of identical log lines, drowning out the one signal an operator
// actually needs to notice. A module-scope flag gives a single, findable
// line at the cost of not re-warning after the first request in a given
// process, which is an acceptable trade for a condition that does not
// change while the process is running.
let warnedMissingSecretInProduction = false;

function warnIfSecretMissingInProduction(secret: string | undefined): void {
  if (warnedMissingSecretInProduction) return;
  if (process.env.NODE_ENV !== "production") return;
  if (secret !== undefined && secret.trim() !== "") return;

  warnedMissingSecretInProduction = true;
  // Deliberately no secret value in this message: there is none to log in
  // the case that triggers it, and the message must never depend on one.
  console.warn(
    "[overdue] SITE_GATE_SECRET is not set in production. The deployment " +
      "shield is open: every request is being allowed through with no " +
      "gate cookie or query-param check required. Set SITE_GATE_SECRET to " +
      "close it.",
  );
}

export function proxy(request: NextRequest) {
  const secret = process.env.SITE_GATE_SECRET;
  warnIfSecretMissingInProduction(secret);

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
// api/refresh is excluded because the scheduled job calls it from GitHub
// Actions, which has no browser and therefore no gate cookie. Gating it
// meant the cron could never reach the route at all: verified against the
// live deployment, the workflow received this file's "Not available." 401
// rather than anything the route produced. Nothing caught it earlier
// because playwright.config.ts sets SITE_GATE_SECRET to "" for the server
// it spawns, so the e2e suite exercised the route with the very protection
// that breaks it switched off.
//
// Excluding it does not leave the route open. It carries stronger
// authentication than this gate: a bearer secret compared with
// timingSafeEqual, no hint of a near miss in any response body, and a hard
// 503 refusal when CRON_SECRET is unset rather than defaulting to open.
// This gate remains a shield, never identity; getCurrentUserId is still the
// only source of identity in the app.
//
// /sw.js stays gated: it is fetched with credentials same-origin, so the
// cookie is sent and it registers fine for an unlocked user.
export const config = {
  matcher: [
    // The icon rule is anchored with $ deliberately. Without it the lookahead
    // matches on prefix, so any path merely BEGINNING with an icon name, such
    // as /icon-192.png/anything, would be ungated too.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon-[^/]*\\.png$|api/refresh$).*)",
  ],
};
