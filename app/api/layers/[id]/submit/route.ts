import { z } from "zod";
import { getEngine } from "@/lib/ai";
import { getDb } from "@/lib/db/client";
import { failure } from "@/lib/layers/http";
import { isDontGetIt } from "@/lib/layers/loop";
import { getThread, submitWriteback } from "@/lib/layers/writeback";
import { readBody } from "@/lib/projects/api";

export const maxDuration = 300;

/**
 * The student's message in the write-back box. "I don't get it" is handed back to the client to stream, anything else is a write-back and gets reviewed.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/layers/[id]/submit">) {
  const { id } = await ctx.params;
  const body = await readBody(req, z.object({ text: z.string().max(40_000) }));
  if ("error" in body) return body.error;
  const db = getDb();
  try {
    if (isDontGetIt(body.data.text)) return Response.json({ kind: "dont_get_it", thread: getThread(db, id) });
    const r = await submitWriteback(db, getEngine(), id, body.data.text, req.signal);
    return Response.json({ kind: "review", verdict: r.review.verdict, thread: r.thread });
  } catch (e) {
    return failure(e);
  }
}
