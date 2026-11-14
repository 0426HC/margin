import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { failure } from "@/lib/layers/http";
import { SAVE_CHOICES } from "@/lib/layers/loop";
import { saveWriteback } from "@/lib/layers/writeback";
import { readBody } from "@/lib/projects/api";

/** "Send to Note to Self?": the student's own writing, the refined version, or neither. No engine call. */
export async function POST(req: Request, ctx: RouteContext<"/api/layers/[id]/save">) {
  const { id } = await ctx.params;
  const body = await readBody(req, z.object({ writebackId: z.string().min(1), choice: z.enum(SAVE_CHOICES) }));
  if ("error" in body) return body.error;
  try {
    return Response.json({ thread: saveWriteback(getDb(), id, body.data.writebackId, body.data.choice) });
  } catch (e) {
    return failure(e);
  }
}
