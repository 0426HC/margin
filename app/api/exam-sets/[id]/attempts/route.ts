import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { startAttempt } from "@/lib/exam/service";
import { failure } from "@/lib/layers/http";
import { readBody } from "@/lib/projects/api";

/** Start a sitting of a set: "Use the real time limit" or "No timer". Try again is another sitting of the same set. */
export async function POST(req: Request, ctx: RouteContext<"/api/exam-sets/[id]/attempts">) {
  const { id } = await ctx.params;
  const body = await readBody(req, z.object({ timer: z.enum(["real", "none"]) }));
  if ("error" in body) return body.error;
  try {
    return Response.json({ attempt: startAttempt(getDb(), id, body.data.timer) }, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
