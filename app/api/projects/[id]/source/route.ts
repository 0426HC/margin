import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { fail } from "@/lib/projects/api";
import { getSourcePage } from "@/lib/layers/source-view";

const query = z.object({ file: z.string().min(1), page: z.coerce.number().int().min(1), near: z.string().max(2000).optional() });

/** One page of one of the project's files, verbatim, with the cited passage marked. Read-only. */
export async function GET(req: Request, ctx: RouteContext<"/api/projects/[id]/source">) {
  const { id } = await ctx.params;
  const q = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return fail("Say which file and page to show.");
  const view = getSourcePage(getDb(), id, q.data.file, q.data.page, q.data.near);
  if (!view) return fail(`Margin can't find page ${q.data.page} of ${q.data.file}. The file may have been removed.`, 404);
  return Response.json(view);
}
