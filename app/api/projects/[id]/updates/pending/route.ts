import { getEngine } from "@/lib/ai";
import { getDb } from "@/lib/db/client";
import { failure } from "@/lib/layers/http";
import { refuseIfDemo } from "@/lib/projects/demo-guard";
import { getPending, placeNewPassages } from "@/lib/updates/service";

export const maxDuration = 300;

/** What waits for the student after files were added: new layers to approve, and any passages not placed yet. */
export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/updates/pending">) {
  const { id } = await ctx.params;
  return Response.json(getPending(getDb(), id));
}

/** Try placing the passages that are in no layer again (after the engine was unavailable). */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/updates/pending">) {
  const { id } = await ctx.params;
  const db = getDb();
  const refused = refuseIfDemo(db, { projectId: id });
  if (refused) return refused;
  try {
    const placed = await placeNewPassages(db, getEngine(), id, req.signal);
    return Response.json({ placed, pending: getPending(db, id) });
  } catch (e) {
    return failure(e);
  }
}
