import { timingSafeEqual } from "node:crypto";
import { drizzleRefreshPort } from "@/lib/refresh/port";
import { runRefresh } from "@/lib/refresh/run";

// Mirrors src/lib/gate.ts's constantTimeEquals exactly: a length guard before
// timingSafeEqual, since timingSafeEqual throws on mismatched buffer lengths
// rather than returning false.
function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  if (bufferA.length !== bufferB.length) {
    return false;
  }

  return timingSafeEqual(bufferA, bufferB);
}

function isAuthorised(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization");
  if (!header) return false;

  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;

  const supplied = header.slice(prefix.length);
  return constantTimeEquals(supplied, secret);
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;

  // Unset is the opposite default of the deployment gate: a gate with no
  // secret is inert and harmless on a dev machine, but a refresh endpoint
  // with no secret is an open door to a job that makes dozens of provider
  // calls. So a missing secret refuses every request rather than letting
  // one through unauthenticated.
  if (secret === undefined || secret.trim() === "") {
    return Response.json({ error: "Refresh endpoint is not configured" }, {
      status: 503,
    });
  }

  if (!isAuthorised(request, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runRefresh(drizzleRefreshPort, new Date());

  // Counts only. Never echo request headers or anything derived from the
  // secret comparison, and never include per-failure provider error text
  // that might leak details about the deployment.
  return Response.json(
    {
      examined: result.examined,
      changed: result.changed,
      changeRows: result.changeRows,
      failures: result.failures.length,
    },
    { status: 200 },
  );
}

export async function GET(): Promise<Response> {
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
