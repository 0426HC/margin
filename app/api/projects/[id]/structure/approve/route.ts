import { getDb } from "@/lib/db/client";
import { kickBackground } from "@/lib/layers/background";
import { failure } from "@/lib/layers/http";
import { approvePlan } from "@/lib/layers/service";
import { refuseIfDemo } from "@/lib/projects/demo-guard";

/** "Looks good": the whole plan, every week at once. Background writing starts on the current week's layers at once. */
export async function POST(_req: Request, ctx: RouteContext<"/api/projects/[id]/structure/approve">) {
  const { id } = await ctx.params;
  const refused = refuseIfDemo(getDb(), { projectId: id });
  if (refused) return refused;
  try {
    approvePlan(getDb(), id);
    kickBackground();
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
