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
      if (!secret) {
        return NextResponse.next();
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
      return new NextResponse("Not available.", {
        status: 401,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
