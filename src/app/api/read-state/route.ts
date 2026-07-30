import { getCurrentUserId } from "@/lib/current-user";
import { drizzleReadStateStore, isReadStateValue } from "@/lib/read-state";

interface ReadStateRequest {
  bookId: string;
  state: string;
}

export async function POST(request: Request): Promise<Response> {
  let body: Partial<ReadStateRequest>;
  try {
    body = (await request.json()) as Partial<ReadStateRequest>;
  } catch {
    return Response.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  if (!body.bookId) {
    return Response.json({ error: "bookId is required" }, { status: 400 });
  }
  if (!isReadStateValue(body.state)) {
    return Response.json({ error: "state is not a known value" }, {
      status: 400,
    });
  }

  const userId = await getCurrentUserId();
  await drizzleReadStateStore.set(userId, body.bookId, body.state);

  return Response.json({ ok: true }, { status: 200 });
}
