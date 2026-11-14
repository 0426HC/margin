import { getDb } from "@/lib/db/client";
import { fail } from "@/lib/projects/api";
import { refuseIfDemo } from "@/lib/projects/demo-guard";
import { addFile } from "@/lib/projects/service";

/** One file per request, so each file gets its own live status on the client. */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/files">) {
  const { id } = await ctx.params;
  const refused = refuseIfDemo(getDb(), { projectId: id });
  if (refused) return refused;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail("No file came with that request.");
  const relPath = String(form?.get("relPath") || file.name).replace(/^\/+/, "");
  const row = await addFile(getDb(), id, { name: file.name, relPath, bytes: new Uint8Array(await file.arrayBuffer()) });
  return Response.json(row);
}
