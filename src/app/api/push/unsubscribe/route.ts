import { getCurrentUserId } from "@/lib/current-user";
import { drizzleSubscriptionStore } from "@/lib/push/subscriptions";

interface UnsubscribeRequest {
  endpoint: string;
}

export async function POST(request: Request): Promise<Response> {
  let body: Partial<UnsubscribeRequest>;
  try {
    body = (await request.json()) as Partial<UnsubscribeRequest>;
  } catch {
    return Response.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  if (typeof body.endpoint !== "string" || body.endpoint.length === 0) {
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
