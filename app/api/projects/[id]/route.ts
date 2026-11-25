import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { fail, readBody } from "@/lib/projects/api";
import { refuseIfDemo } from "@/lib/projects/demo-guard";
import { setWeekCount } from "@/lib/weeks/count";
import { deleteProject } from "@/lib/projects/delete";

/** Permanently delete a project: its files on disk and every row that belongs to it. The demo can be deleted too. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const { id } = await ctx.params;
  if (!deleteProject(getDb(), id)) return fail("That project is already gone. Go back to your projects.", 404);
  revalidatePath("/");
  return Response.json({ deleted: true });
}

/** "This course has __ weeks". Lecture notes, the Weeks view and week labels all follow it. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const { id } = await ctx.params;
  const refused = refuseIfDemo(getDb(), { projectId: id });
  if (refused) return refused;
  const r = await readBody(req, z.object({ weekCount: z.number().int().min(1, "A course has at least one week.").max(60, "A course has at most 60 weeks.") }));
  if ("error" in r) return r.error;
  setWeekCount(getDb(), id, r.data.weekCount);
  revalidatePath(`/p/${id}`, "layout");
  return Response.json({ ok: true });
}
