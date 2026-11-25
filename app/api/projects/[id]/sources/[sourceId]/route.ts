import { getDb } from "@/lib/db/client";
import { fail } from "@/lib/projects/api";
import { deleteSource } from "@/lib/talk/sources";

/** Delete one collected source for good. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/projects/[id]/sources/[sourceId]">) {
  const { id, sourceId } = await ctx.params;
  return deleteSource(getDb(), id, sourceId) ? Response.json({ deleted: true }) : fail("That source is already gone. Reload the list.", 404);
}
