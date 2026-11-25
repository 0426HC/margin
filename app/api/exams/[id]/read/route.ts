import { getEngine } from "@/lib/ai";
import { getDb } from "@/lib/db/client";
import { readExamSummary } from "@/lib/exam/service";
import { failure } from "@/lib/layers/http";

export const maxDuration = 300;

/** Read the exam sheet into a summary for the student to check. */
export async function POST(req: Request, ctx: RouteContext<"/api/exams/[id]/read">) {
  const { id } = await ctx.params;
  try {
    return Response.json({ summary: await readExamSummary(getDb(), getEngine(), id, req.signal) });
  } catch (e) {
    return failure(e);
  }
}
