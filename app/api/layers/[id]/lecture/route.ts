import { getEngine } from "@/lib/ai";
import { getDb } from "@/lib/db/client";
import { failure } from "@/lib/layers/http";
import { writeLecture } from "@/lib/lecture/service";

export const maxDuration = 300;

/** Write the layer's Lecture tab on first open, then cache it. If it exists, only its class-notes section is made again, and only when the lecture notes changed. */
export async function POST(req: Request, ctx: RouteContext<"/api/layers/[id]/lecture">) {
  const { id } = await ctx.params;
  try {
    await writeLecture(getDb(), getEngine(), id, { signal: req.signal });
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
