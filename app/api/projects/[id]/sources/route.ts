import { getDb } from "@/lib/db/client";
import { getSources, hasUnread } from "@/lib/talk/sources";

/** The sources the Librarian has collected for this project, grouped by topic, and whether there is conversation it hasn't read yet. */
export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/sources">) {
  const { id } = await ctx.params;
  const db = getDb();
  return Response.json({ groups: getSources(db, id), pending: hasUnread(db, id) });
}
