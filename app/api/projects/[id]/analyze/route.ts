import { getDb } from "@/lib/db/client";
import { refuseIfDemo } from "@/lib/projects/demo-guard";
import { analyzeProject } from "@/lib/projects/service";

export async function POST(_req: Request, ctx: RouteContext<"/api/projects/[id]/analyze">) {
  const { id } = await ctx.params;
  const refused = refuseIfDemo(getDb(), { projectId: id });
  if (refused) return refused;
  analyzeProject(getDb(), id);
  return Response.json({ ok: true });
}
