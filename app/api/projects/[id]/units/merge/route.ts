import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { fail, readBody } from "@/lib/projects/api";
import { refuseIfDemo } from "@/lib/projects/demo-guard";
import { mergeUnits } from "@/lib/projects/service";

const body = z.object({ fromId: z.string().min(1), intoId: z.string().min(1) });

export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/units/merge">) {
  const { id } = await ctx.params;
  const refused = refuseIfDemo(getDb(), { projectId: id });
  if (refused) return refused;
  const r = await readBody(req, body);
  if ("error" in r) return r.error;
  try {
    mergeUnits(getDb(), r.data.fromId, r.data.intoId);
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Couldn't merge those units.");
  }
}
