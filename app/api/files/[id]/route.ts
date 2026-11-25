import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { fail, readBody } from "@/lib/projects/api";
import { refuseIfDemo } from "@/lib/projects/demo-guard";
import { moveFile, removeFile } from "@/lib/projects/service";

const body = z.object({ unitId: z.string().min(1, "Pick a unit.") });

export async function PATCH(req: Request, ctx: RouteContext<"/api/files/[id]">) {
  const { id } = await ctx.params;
  const refused = refuseIfDemo(getDb(), { fileId: id });
  if (refused) return refused;
  const r = await readBody(req, body);
  if ("error" in r) return r.error;
  try {
    moveFile(getDb(), id, r.data.unitId);
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Couldn't move that file.");
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/files/[id]">) {
  const { id } = await ctx.params;
  const refused = refuseIfDemo(getDb(), { fileId: id });
  if (refused) return refused;
  removeFile(getDb(), id);
  return Response.json({ ok: true });
}
