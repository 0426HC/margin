import { getDb } from "@/lib/db/client";
import { refuseIfDemo } from "@/lib/projects/demo-guard";
import { finishReview } from "@/lib/projects/service";

export async function POST(_req: Request, ctx: RouteContext<"/api/projects/[id]/finish">) {
  const { id } = await ctx.params;
  const refused = refuseIfDemo(getDb(), { projectId: id });
  if (refused) return refused;
  finishReview(getDb(), id);
  return Response.json({ ok: true });
}
