import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { failure } from "@/lib/layers/http";
import { approvePart } from "@/lib/layers/service";
import { readBody } from "@/lib/projects/api";
import { refuseIfDemo } from "@/lib/projects/demo-guard";

export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/structure/approve">) {
  const { id } = await ctx.params;
  const refused = refuseIfDemo(getDb(), { projectId: id });
  if (refused) return refused;
  const body = await readBody(req, z.object({ part: z.enum(["A", "B"]) }));
  if ("error" in body) return body.error;
  try {
    approvePart(getDb(), id, body.data.part);
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
