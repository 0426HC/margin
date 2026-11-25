import { getDb } from "@/lib/db/client";
import { createExam, listExams } from "@/lib/exam/service";
import { failure } from "@/lib/layers/http";
import { fail } from "@/lib/projects/api";
import { refuseIfDemo } from "@/lib/projects/demo-guard";
import { addFile } from "@/lib/projects/service";

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/exams">) {
  const { id } = await ctx.params;
  return Response.json({ exams: listExams(getDb(), id) });
}

/** "Add exam sheet": store the file as an exam sheet and make its exam (Midterm or Final, from its name and first words). Reading it is the next step. */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/exams">) {
  const { id } = await ctx.params;
  const db = getDb();
  const refused = refuseIfDemo(db, { projectId: id });
  if (refused) return refused;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail("No file came with that request.");
  const kind = form?.get("kind");
  try {
    const row = await addFile(db, id, { name: file.name, relPath: file.name, bytes: new Uint8Array(await file.arrayBuffer()), label: { type: "exam", week: null, reason: "Added in the exam room.", check: false } });
    if (row.status !== "done") return fail(row.error ?? "Margin couldn't read that file.", 400);
    const examId = createExam(db, id, row.id, kind === "midterm" || kind === "final" || kind === "exam" ? kind : undefined);
    return Response.json({ id: examId }, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
