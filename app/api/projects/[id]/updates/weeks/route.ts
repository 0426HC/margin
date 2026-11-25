import { getDb } from "@/lib/db/client";
import { getCourseWeeks } from "@/lib/updates/service";

/** The course's weeks (with dates from the syllabus and how many files each holds), for the week dropdown. */
export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/updates/weeks">) {
  const { id } = await ctx.params;
  const { weeks } = getCourseWeeks(getDb(), id);
  return Response.json({ weeks });
}
