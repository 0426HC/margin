import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { failure } from "@/lib/layers/http";
import { fail, readBody } from "@/lib/projects/api";
import { refuseIfDemo } from "@/lib/projects/demo-guard";
import { approveProposals, getPending, UpdateError } from "@/lib/updates/service";

const body = z.object({
  decisions: z
    .array(
      z.object({
        layerId: z.string(),
        action: z.enum(["approve", "merge"]),
        mergeInto: z.string().optional(),
        title: z.string().max(80).optional(),
        bigQuestion: z.string().max(220).optional(),
      }),
    )
    .max(100),
});

/** The student's answer on each proposed layer: approve it (maybe renamed) or add its passages to an existing layer. */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/updates/approve">) {
  const { id } = await ctx.params;
  const db = getDb();
  const refused = refuseIfDemo(db, { projectId: id });
  if (refused) return refused;
  const b = await readBody(req, body);
  if ("error" in b) return b.error;
  try {
    const r = approveProposals(db, id, b.data.decisions);
    return Response.json({ ...r, pending: getPending(db, id) });
  } catch (e) {
    if (e instanceof UpdateError) return fail(e.message, 400);
    return failure(e);
  }
}
