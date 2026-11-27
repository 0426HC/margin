import { z } from "zod";
import { getEngine } from "@/lib/ai";
import { getDb } from "@/lib/db/client";
import { failure } from "@/lib/layers/http";
import { notesSaved } from "@/lib/lecture/schedule";
import { fail, readBody } from "@/lib/projects/api";
import { noteBlocksSchema } from "@/lib/talk/notepad";
import { getWeekNotes, saveWeekNotes, validWeek } from "@/lib/weeks/notes";

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/weeks/[week]/notes">) {
  const { id, week } = await ctx.params;
  if (!validWeek(Number(week))) return fail("That isn't a week of the course.", 404);
  return Response.json(getWeekNotes(getDb(), id, Number(week)));
}

/**
 * Autosave: the whole page of that week, as blocks. Lecture notes are the student's own, so the demo allows them too. `left`: the student is
 * leaving the page, so the week's Lecture tab writes its notes section now instead of after the quiet time.
 */
export async function PUT(req: Request, ctx: RouteContext<"/api/projects/[id]/weeks/[week]/notes">) {
  const { id, week } = await ctx.params;
  if (!validWeek(Number(week))) return fail("That isn't a week of the course.", 404);
  const body = await readBody(req, z.object({ blocks: noteBlocksSchema, left: z.boolean().optional() }));
  if ("error" in body) return body.error;
  try {
    const db = getDb();
    const saved = saveWeekNotes(db, id, Number(week), body.data.blocks);
    notesSaved(db, getEngine(), id, Number(week), { left: body.data.left });
    return Response.json(saved);
  } catch (e) {
    return failure(e);
  }
}
