import { getDb } from "@/lib/db/client";
import { searchProject } from "@/lib/layers/search";

/** Search the project's files. Returns each hit's file, page, a snippet and the layer it belongs to. */
export async function GET(req: Request, ctx: RouteContext<"/api/projects/[id]/search">) {
  const { id } = await ctx.params;
  const q = new URL(req.url).searchParams.get("q")?.slice(0, 200) ?? "";
  return Response.json({ hits: q.trim() ? searchProject(getDb(), id, q) : [] });
}
