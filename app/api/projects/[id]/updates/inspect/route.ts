import { fail } from "@/lib/projects/api";
import { inspectFile } from "@/lib/updates/service";

/** Read one file in memory and measure it for Claude (size, headings, opening words). Nothing is stored or decided. */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/updates/inspect">) {
  await ctx.params;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail("No file came with that request.");
  const relPath = String(form?.get("relPath") || file.name).replace(/^\/+/, "");
  return Response.json(await inspectFile({ name: file.name, relPath, bytes: new Uint8Array(await file.arrayBuffer()) }));
}
