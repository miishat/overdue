import { getCurrentUserId } from "@/lib/current-user";
import {
  drizzleSubscriptionStore,
  isSubscriptionInput,
} from "@/lib/push/subscriptions";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  if (!isSubscriptionInput(body)) {
    return Response.json(
      { error: "A valid endpoint, p256dh, and auth are required" },
      { status: 400 },
    );
  }

  const userId = await getCurrentUserId();
  await drizzleSubscriptionStore.upsert(userId, body);

  // Never echo the subscription back: p256dh and auth are secrets.
  return Response.json({ ok: true }, { status: 200 });
}
