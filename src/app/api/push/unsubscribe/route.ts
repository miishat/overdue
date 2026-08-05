import { getCurrentUserId } from "@/lib/current-user";
import { drizzleSubscriptionStore } from "@/lib/push/subscriptions";

interface UnsubscribeRequest {
  endpoint: string;
}

/**
 * Narrowing guard rather than a cast, matching the pattern used by
 * isSubscriptionInput for the subscribe route.
 */
function isUnsubscribeRequest(value: unknown): value is UnsubscribeRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.endpoint === "string" && candidate.endpoint.length > 0;
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  if (!isUnsubscribeRequest(body)) {
    return Response.json({ error: "endpoint is required" }, { status: 400 });
  }

  const userId = await getCurrentUserId();
  await drizzleSubscriptionStore.remove(userId, body.endpoint);

  // Removing an endpoint that was never stored still satisfies the
  // client's intent (it is not subscribed), so this always returns 200
  // rather than a 404 that would leave the browser thinking it is still
  // subscribed.
  return Response.json({ ok: true }, { status: 200 });
}
