import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { setViewMode } from "@/lib/layers/view-mode";
import { fail, readBody } from "@/lib/projects/api";

/** Remember which tab (Explained or Source) the student is on for this layer. */
export async function PUT(req: Request, ctx: RouteContext<"/api/layers/[id]/view">) {
  const { id } = await ctx.params;
  const body = await readBody(req, z.object({ mode: z.enum(["explained", "source"]) }));
  if ("error" in body) return body.error;
  const db = getDb();
  const row = db.select({ projectId: s.parts.projectId }).from(s.layers).innerJoin(s.parts, eq(s.parts.id, s.layers.partId)).where(eq(s.layers.id, id)).get();
  if (!row) return fail("That layer no longer exists. Reload the page.", 404);
  setViewMode(db, row.projectId, id, body.data.mode);
  return Response.json({ ok: true });
}
