import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { failure } from "@/lib/layers/http";
import { readBody } from "@/lib/projects/api";
import { getNotepad, noteBlocksSchema, saveNotepad } from "@/lib/talk/notepad";

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/notepad">) {
  const { id } = await ctx.params;
  return Response.json(getNotepad(getDb(), id));
}

/** Autosave: the whole page, as blocks. */
export async function PUT(req: Request, ctx: RouteContext<"/api/projects/[id]/notepad">) {
  const { id } = await ctx.params;
  const body = await readBody(req, z.object({ blocks: noteBlocksSchema }));
  if ("error" in body) return body.error;
  try {
    return Response.json(saveNotepad(getDb(), id, body.data.blocks));
  } catch (e) {
    return failure(e);
  }
}
