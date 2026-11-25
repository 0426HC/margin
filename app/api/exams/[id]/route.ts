import { getDb } from "@/lib/db/client";
import { deleteExam, getExamView } from "@/lib/exam/service";
import { fail } from "@/lib/projects/api";

export async function GET(_req: Request, ctx: RouteContext<"/api/exams/[id]">) {
  const { id } = await ctx.params;
  const view = getExamView(getDb(), id);
  return view ? Response.json(view) : fail("That exam no longer exists.", 404);
}

/** Delete an exam for good: its sheet, uploaded exams, sets, attempts and feedback. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/exams/[id]">) {
  const { id } = await ctx.params;
  return deleteExam(getDb(), id) ? Response.json({ ok: true }) : fail("That exam no longer exists.", 404);
}
