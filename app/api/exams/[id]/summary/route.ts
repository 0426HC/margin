import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { saveExamSummary } from "@/lib/exam/service";
import { failure } from "@/lib/layers/http";
import { readBody } from "@/lib/projects/api";

/** Save the student's checked or edited summary. `confirm: true` says it looks right, which unlocks generating questions. */
export async function PUT(req: Request, ctx: RouteContext<"/api/exams/[id]/summary">) {
  const { id } = await ctx.params;
  const body = await readBody(req, z.object({ summary: z.unknown(), confirm: z.boolean().default(false) }));
  if ("error" in body) return body.error;
  try {
    return Response.json({ summary: saveExamSummary(getDb(), id, body.data.summary, body.data.confirm) });
  } catch (e) {
    return failure(e);
  }
}
