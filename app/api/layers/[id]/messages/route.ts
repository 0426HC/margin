import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { getThread } from "@/lib/layers/writeback";
import { fail } from "@/lib/projects/api";

/** The layer chatbot's saved history, and where the layer stands. */
export async function GET(_req: Request, ctx: RouteContext<"/api/layers/[id]/messages">) {
  const { id } = await ctx.params;
  const db = getDb();
  if (!db.select({ id: s.layers.id }).from(s.layers).where(eq(s.layers.id, id)).get()) return fail("That layer no longer exists. Reload the page.", 404);
  return Response.json({ thread: getThread(db, id) });
}
