import { getEngine } from "@/lib/ai";
import { getDb } from "@/lib/db/client";
import { failure } from "@/lib/layers/http";
import { refreshLayer } from "@/lib/layers/service";

export const maxDuration = 300;

/** "Refresh this layer": write Explained again from the layer's current files. Write-ups and saved versions are never changed. The week's Lecture tab follows its files by itself. */
export async function POST(req: Request, ctx: RouteContext<"/api/layers/[id]/refresh">) {
  const { id } = await ctx.params;
  try {
    await refreshLayer(getDb(), getEngine(), id, req.signal);
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
