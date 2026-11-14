import { getEngine } from "@/lib/ai";
import { getDb } from "@/lib/db/client";
import { failure } from "@/lib/layers/http";
import { writeLayerContent } from "@/lib/layers/service";

export const maxDuration = 300;

/** Write the layer's Source and Explained tabs on first open, then cache them. 409 until the Part's layers are approved. */
export async function POST(req: Request, ctx: RouteContext<"/api/layers/[id]/write">) {
  const { id } = await ctx.params;
  try {
    await writeLayerContent(getDb(), getEngine(), id, req.signal);
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
