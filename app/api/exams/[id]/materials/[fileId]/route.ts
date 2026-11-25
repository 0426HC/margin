import { getDb } from "@/lib/db/client";
import { removeMaterial } from "@/lib/exam/service";
import { failure } from "@/lib/layers/http";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/exams/[id]/materials/[fileId]">) {
  const { id, fileId } = await ctx.params;
  try {
    removeMaterial(getDb(), id, fileId);
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
