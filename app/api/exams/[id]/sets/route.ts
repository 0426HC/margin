import { getEngine } from "@/lib/ai";
import { getDb } from "@/lib/db/client";
import { generateSet } from "@/lib/exam/service";
import { failure } from "@/lib/layers/http";

export const maxDuration = 300;

/** Write a practice exam in the sheet's format. The first call writes the first set; later calls write a fresh one ("New questions"). */
export async function POST(req: Request, ctx: RouteContext<"/api/exams/[id]/sets">) {
  const { id } = await ctx.params;
  try {
    return Response.json({ set: await generateSet(getDb(), getEngine(), id, req.signal) }, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
