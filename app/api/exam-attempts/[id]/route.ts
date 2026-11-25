import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { saveAnswers } from "@/lib/exam/service";
import { failure } from "@/lib/layers/http";
import { readBody } from "@/lib/projects/api";

/** Autosave the answers of a sitting. */
export async function PUT(req: Request, ctx: RouteContext<"/api/exam-attempts/[id]">) {
  const { id } = await ctx.params;
  const body = await readBody(req, z.object({ answers: z.record(z.string(), z.string()) }));
  if ("error" in body) return body.error;
  try {
    saveAnswers(getDb(), id, body.data.answers);
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
