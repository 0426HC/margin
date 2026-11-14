import { getEngine } from "@/lib/ai";
import { getDb } from "@/lib/db/client";
import { failure } from "@/lib/layers/http";
import { readBody } from "@/lib/projects/api";
import { draftFromWriteup, quickNoteSchema } from "@/lib/talk/quicknotes";

export const maxDuration = 120;

/** Draft quick notes from the layer's saved write-up. The draft is returned, not saved; the student edits it and autosave keeps it. */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/quick-notes/draft">) {
  const { id } = await ctx.params;
  const body = await readBody(req, quickNoteSchema.omit({ text: true }));
  if ("error" in body) return body.error;
  try {
    return Response.json({ text: await draftFromWriteup(getDb(), getEngine(), id, body.data.targetType, body.data.targetId, req.signal) });
  } catch (e) {
    return failure(e);
  }
}
