import { z } from "zod";
import { getEngine } from "@/lib/ai";
import { getDb } from "@/lib/db/client";
import { handIn } from "@/lib/exam/service";
import { failure } from "@/lib/layers/http";
import { readBody } from "@/lib/projects/api";

export const maxDuration = 300;

/** Hand in: multiple choice is marked by code, everything answered is reviewed by the Examiner, and unanswered questions are skipped. */
export async function POST(req: Request, ctx: RouteContext<"/api/exam-attempts/[id]/hand-in">) {
  const { id } = await ctx.params;
  const body = await readBody(req, z.object({ answers: z.record(z.string(), z.string()).optional() }));
  if ("error" in body) return body.error;
  try {
    return Response.json({ attempt: await handIn(getDb(), getEngine(), id, body.data.answers, req.signal) });
  } catch (e) {
    return failure(e);
  }
}
