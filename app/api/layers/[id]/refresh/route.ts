import { getEngine } from "@/lib/ai";
import { getDb } from "@/lib/db/client";
import { failure } from "@/lib/layers/http";
import { refreshLayerAndLecture } from "@/lib/lecture/service";

export const maxDuration = 300;

/** "Refresh this layer": write Explained (and the Lecture tab, if it was written) again from the layer's current files. Write-ups and saved versions are never changed. */
export async function POST(req: Request, ctx: RouteContext<"/api/layers/[id]/refresh">) {
  const { id } = await ctx.params;
  try {
    await refreshLayerAndLecture(getDb(), getEngine(), id, req.signal);
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
