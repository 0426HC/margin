import { getDb } from "@/lib/db/client";
import { failure } from "@/lib/layers/http";
import { readBody } from "@/lib/projects/api";
import { getQuickNotes, quickNoteSchema, saveQuickNote } from "@/lib/talk/quicknotes";

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/quick-notes">) {
  const { id } = await ctx.params;
  return Response.json({ notes: getQuickNotes(getDb(), id) });
}

/** Autosave one layer's quick notes. */
export async function PUT(req: Request, ctx: RouteContext<"/api/projects/[id]/quick-notes">) {
  const { id } = await ctx.params;
  const body = await readBody(req, quickNoteSchema);
  if ("error" in body) return body.error;
  try {
    return Response.json({ text: saveQuickNote(getDb(), id, body.data.targetType, body.data.targetId, body.data.text) });
  } catch (e) {
    return failure(e);
  }
}
