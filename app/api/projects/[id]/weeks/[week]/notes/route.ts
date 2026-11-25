import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { failure } from "@/lib/layers/http";
import { fail, readBody } from "@/lib/projects/api";
import { noteBlocksSchema } from "@/lib/talk/notepad";
import { getWeekNotes, saveWeekNotes, validWeek } from "@/lib/weeks/notes";

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/weeks/[week]/notes">) {
  const { id, week } = await ctx.params;
  if (!validWeek(Number(week))) return fail("That isn't a week of the course.", 404);
  return Response.json(getWeekNotes(getDb(), id, Number(week)));
}

/** Autosave: the whole page of that week, as blocks. Lecture notes are the student's own, so the demo allows them too. */
export async function PUT(req: Request, ctx: RouteContext<"/api/projects/[id]/weeks/[week]/notes">) {
  const { id, week } = await ctx.params;
  if (!validWeek(Number(week))) return fail("That isn't a week of the course.", 404);
  const body = await readBody(req, z.object({ blocks: noteBlocksSchema }));
  if ("error" in body) return body.error;
  try {
    return Response.json(saveWeekNotes(getDb(), id, Number(week), body.data.blocks));
  } catch (e) {
    return failure(e);
  }
}
