import { searchAllProviders } from "@/providers/registry";
import { groupByIdentity } from "@/resolution/identity";
import { resolveGroup } from "@/resolution/resolve";

export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) {
    return Response.json(
      { error: "Query must be at least two characters." },
      { status: 400 },
    );
  }

  const records = await searchAllProviders(query, request.signal);
  const results = groupByIdentity(records)
    .map(resolveGroup)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 20);

  return Response.json({ results });
}
