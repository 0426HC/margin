import { z } from "zod";
import { getEngine } from "@/lib/ai";
import { getDb } from "@/lib/db/client";
import { failure } from "@/lib/layers/http";
import { readBody } from "@/lib/projects/api";
import { refuseIfDemo } from "@/lib/projects/demo-guard";
import { labelNewFiles } from "@/lib/updates/service";

export const maxDuration = 600;

const facts = z.object({
  format: z.string().max(40),
  author: z.string().max(80).nullable().default(null),
  pages: z.number().int().min(0),
  pageWord: z.string().max(60),
  words: z.number().int().min(0),
  wordsPerPage: z.number().int().min(0),
  headings: z.array(z.string().max(200)).max(40),
  opening: z.string().max(20_000),
});
const body = z.object({ files: z.array(z.object({ relPath: z.string().min(1).max(1000), facts })).min(1).max(200) });

/** What the new files are: Claude labels each (week, type, how sure, why) against the course's syllabus and weeks. Nothing is stored. */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/updates/label">) {
  const { id } = await ctx.params;
  const refused = refuseIfDemo(getDb(), { projectId: id });
  if (refused) return refused;
  const r = await readBody(req, body);
  if ("error" in r) return r.error;
  try {
    return Response.json(await labelNewFiles(getDb(), getEngine(), id, r.data.files, undefined, req.signal));
  } catch (e) {
    return failure(e);
  }
}
