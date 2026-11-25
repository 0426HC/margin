import { getDb } from "@/lib/db/client";
import { fail } from "@/lib/projects/api";
import { refuseIfDemo } from "@/lib/projects/demo-guard";
import { FILE_TYPES, type FileType } from "@/lib/projects/file-kinds";
import { addFile } from "@/lib/projects/service";

/**
 * Store one approved file and read it. It sits unused (in no week, no layer) until "commit" puts the whole approved set into the course.
 * One file per request, so each gets its own live status.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/updates/stage">) {
  const { id } = await ctx.params;
  const refused = refuseIfDemo(getDb(), { projectId: id });
  if (refused) return refused;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail("No file came with that request.");
  const relPath = String(form?.get("relPath") || file.name).replace(/^\/+/, "");
  const type = String(form?.get("type") ?? "");
  const week = Number(form?.get("week"));
  const row = await addFile(getDb(), id, {
    name: file.name,
    relPath,
    bytes: new Uint8Array(await file.arrayBuffer()),
    label: (FILE_TYPES as readonly string[]).includes(type)
      ? { type: type as FileType, week: Number.isInteger(week) && week >= 1 && week <= 60 ? week : null, reason: String(form?.get("reason") ?? "").slice(0, 300) || null, check: form?.get("check") === "1" }
      : undefined,
  });
  return Response.json(row);
}
