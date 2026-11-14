import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { readBody } from "@/lib/projects/api";
import { refuseIfDemo } from "@/lib/projects/demo-guard";
import { renameUnit } from "@/lib/projects/service";

const body = z.object({ title: z.string().trim().min(1, "A unit needs a name.").max(120) });

export async function PATCH(req: Request, ctx: RouteContext<"/api/projects/[id]/units/[unitId]">) {
  const { unitId } = await ctx.params;
  const refused = refuseIfDemo(getDb(), { unitId });
  if (refused) return refused;
  const r = await readBody(req, body);
  if ("error" in r) return r.error;
  renameUnit(getDb(), unitId, r.data.title);
  return Response.json({ ok: true });
}
