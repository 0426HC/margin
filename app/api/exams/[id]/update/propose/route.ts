import { getEngine } from "@/lib/ai";
import { getDb } from "@/lib/db/client";
import { proposeExamUpdate } from "@/lib/exam/service";
import { ImportError, parseFile } from "@/lib/import/parse";
import { failure } from "@/lib/layers/http";
import { fail } from "@/lib/projects/api";

/**
 * "Update exam details": read an updated sheet and/or a note of what the student heard, and propose the changed details. Nothing is saved,
 * not even the sheet: it is read here and sent again with "Confirm changes".
 */
export async function POST(req: Request, ctx: RouteContext<"/api/exams/[id]/update/propose">) {
  const { id } = await ctx.params;
  const form = await req.formData().catch(() => null);
  if (!form) return fail("That request had nothing in it. Add an updated sheet or write what changed.");
  const note = String(form.get("note") ?? "");
  const file = form.get("file");
  try {
    let sheet: { fileName: string; text: string } | null = null;
    if (file instanceof File && file.size) {
      const parsed = await parseFile(file.name, new Uint8Array(await file.arrayBuffer()));
      sheet = { fileName: file.name, text: parsed.blocks.map((b) => b.text).join("\n") };
      if (!sheet.text.trim()) return fail("Margin couldn't find any text in that sheet. Try a PDF or Word file with selectable text.");
    }
    return Response.json({ summary: await proposeExamUpdate(getDb(), getEngine(), id, { note, sheet }, req.signal) });
  } catch (e) {
    if (e instanceof ImportError) return fail(e.message);
    return failure(e);
  }
}
