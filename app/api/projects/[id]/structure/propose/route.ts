import { getEngine } from "@/lib/ai";
import { getDb } from "@/lib/db/client";
import { failure } from "@/lib/layers/http";
import { proposeStructure } from "@/lib/layers/service";
import { refuseIfDemo } from "@/lib/projects/demo-guard";

export const maxDuration = 900; // every week read in full at medium effort, two at a time: a long course takes several minutes

export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/structure/propose">) {
  const { id } = await ctx.params;
  const refused = refuseIfDemo(getDb(), { projectId: id });
  if (refused) return refused;
  try {
    await proposeStructure(getDb(), getEngine(), id, req.signal);
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
