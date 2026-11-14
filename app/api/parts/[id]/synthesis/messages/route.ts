import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { getSynthesisThread } from "@/lib/layers/writeback";
import { fail } from "@/lib/projects/api";

/** The synthesis chatbot's saved history. */
export async function GET(_req: Request, ctx: RouteContext<"/api/parts/[id]/synthesis/messages">) {
  const { id } = await ctx.params;
  const db = getDb();
  if (!db.select({ id: s.parts.id }).from(s.parts).where(eq(s.parts.id, id)).get()) return fail("That Part no longer exists. Reload the page.", 404);
  return Response.json({ thread: getSynthesisThread(db, id) });
}
