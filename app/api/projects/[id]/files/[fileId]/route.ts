import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { failure } from "@/lib/layers/http";
import { kickBackground } from "@/lib/layers/background";
import { readBody } from "@/lib/projects/api";
import { refuseIfDemo } from "@/lib/projects/demo-guard";
import { FILE_TYPES } from "@/lib/projects/file-kinds";
import { relabelFile } from "@/lib/projects/relabel";

const body = z.object({
  week: z.number().int().min(1).max(60).nullable().optional(),
  type: z.enum(FILE_TYPES).optional(),
});

/** Change a file's week or type from the files list. Week labels and the Weeks view follow at once; the weeks' Lecture tabs are written again in the background. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/projects/[id]/files/[fileId]">) {
  const { id, fileId } = await ctx.params;
  const refused = refuseIfDemo(getDb(), { projectId: id });
  if (refused) return refused;
  const r = await readBody(req, body);
  if ("error" in r) return r.error;
  try {
    relabelFile(getDb(), id, fileId, r.data);
    kickBackground();
    revalidatePath(`/p/${id}`, "layout");
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
