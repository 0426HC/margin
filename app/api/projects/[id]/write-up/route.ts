import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { failure } from "@/lib/layers/http";
import { editSaved, removeSaved } from "@/lib/layers/writeback";
import { readBody } from "@/lib/projects/api";
import { belongsToProject } from "@/lib/talk/quicknotes";
import { StructureError } from "@/lib/layers/service";

/** Autosave an edit to a saved write-up from Note to Self. The layer's own write-back pane shows the same text. */
export async function PUT(req: Request, ctx: RouteContext<"/api/projects/[id]/write-up">) {
  const { id } = await ctx.params;
  const body = await readBody(req, z.object({ targetType: z.enum(["layer", "part"]), targetId: z.string().min(1), text: z.string().max(50_000) }));
  if ("error" in body) return body.error;
  try {
    const db = getDb();
    if (!belongsToProject(db, id, body.data.targetType, body.data.targetId)) throw new StructureError("That layer is no longer part of this project. Reload the page.");
    return Response.json(editSaved(db, body.data.targetType, body.data.targetId, body.data.text));
  } catch (e) {
    return failure(e);
  }
}

/** Remove one saved entry from Note to Self (?targetType=layer|part&targetId=...). The layer itself stays. */
export async function DELETE(req: Request, ctx: RouteContext<"/api/projects/[id]/write-up">) {
  const { id } = await ctx.params;
  const q = z.object({ targetType: z.enum(["layer", "part"]), targetId: z.string().min(1) }).safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return Response.json({ error: "Say which entry to remove." }, { status: 400 });
  try {
    return removeSaved(getDb(), id, q.data.targetType, q.data.targetId) ? Response.json({ deleted: true }) : Response.json({ error: "That entry is already gone. Reload Note to Self." }, { status: 404 });
  } catch (e) {
    return failure(e);
  }
}
