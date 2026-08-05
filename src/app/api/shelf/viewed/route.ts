import { getCurrentUserId } from "@/lib/current-user";
import { drizzleSeenStore } from "@/lib/seen";

interface ShelfViewedRequest {
  viewedAt: string;
}

/**
 * Advances the shelf's "last viewed" baseline.
 *
 * Called from a client effect after the shelf has painted (see
 * MarkShelfViewed), not while the server is rendering, so a change that
 * arrived a moment before render is never marked seen before the user had a
 * chance to look at it. The timestamp advanced to is the one the page was
 * rendered with, not "now" at the time this request lands, so a change that
 * arrives in the gap between render and this call still shows as changed on
 * the next visit rather than being silently swallowed.
 */
export async function POST(request: Request): Promise<Response> {
  let body: Partial<ShelfViewedRequest>;
  try {
    body = (await request.json()) as Partial<ShelfViewedRequest>;
  } catch {
    return Response.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  if (!body.viewedAt || typeof body.viewedAt !== "string") {
    return Response.json({ error: "viewedAt is required" }, { status: 400 });
  }

  const posted = new Date(body.viewedAt);
  if (Number.isNaN(posted.getTime())) {
    return Response.json({ error: "viewedAt is not a valid date" }, {
      status: 400,
    });
  }

  const userId = await getCurrentUserId();

  const now = new Date();
  const existingBaseline = await drizzleSeenStore.lastViewedAt(userId);

  // Clamp down: never accept a client-supplied timestamp later than the
  // server's own clock, so a bogus far-future value cannot permanently
  // suppress future badges.
  let at = posted.getTime() > now.getTime() ? now : posted;
  // Clamp up: never move the baseline backwards from what is already
  // stored, preserving monotonicity.
  if (existingBaseline !== null && at.getTime() < existingBaseline.getTime()) {
    at = existingBaseline;
  }

  await drizzleSeenStore.markViewed(userId, at);

  return Response.json({ ok: true }, { status: 200 });
}
