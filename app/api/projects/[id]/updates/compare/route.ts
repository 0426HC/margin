import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { failure } from "@/lib/layers/http";
import { readBody } from "@/lib/projects/api";
import { compareFolder, getCourseWeeks } from "@/lib/updates/service";

const body = z.object({
  files: z.array(z.object({ name: z.string().min(1), relPath: z.string().min(1), hash: z.string().regex(/^[0-9a-f]{64}$/) })).max(5000),
});

/**
 * Which of the picked files are new, changed, removed or unchanged: by path and content hash only. Nothing is written and no AI is
 * asked, so it is free to run as often as the student likes (and it works on the demo, which only refuses the write that comes after).
 */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/updates/compare">) {
  const { id } = await ctx.params;
  const b = await readBody(req, body);
  if ("error" in b) return b.error;
  try {
    const db = getDb();
    return Response.json({ ...compareFolder(db, id, b.data.files), weeks: getCourseWeeks(db, id).weeks });
  } catch (e) {
    return failure(e);
  }
}
