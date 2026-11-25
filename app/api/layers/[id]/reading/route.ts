import { getDb } from "@/lib/db/client";
import { fullReading, weekReadings } from "@/lib/layers/full-reading";
import { fail } from "@/lib/projects/api";

/**
 * "Show full reading": without `?file`, the readings and lecture files of the layer's week; with it, that file in full, verbatim, with
 * this layer's passages marked. Read-only.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/layers/[id]/reading">) {
  const { id } = await ctx.params;
  const db = getDb();
  const fileId = new URL(req.url).searchParams.get("file");
  if (!fileId) {
    const files = weekReadings(db, id);
    if (!files) return fail("That layer no longer exists. Reload the page.", 404);
    return Response.json({ files });
  }
  const view = fullReading(db, id, fileId);
  if (!view) return fail("That file isn't one of this week's readings any more. Reload the page.", 404);
  return Response.json(view);
}
