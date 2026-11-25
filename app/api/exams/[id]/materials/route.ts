import { getDb } from "@/lib/db/client";
import { attachMaterial } from "@/lib/exam/service";
import { failure } from "@/lib/layers/http";
import { fail } from "@/lib/projects/api";
import { addFile } from "@/lib/projects/service";
import { eq } from "drizzle-orm";
import * as s from "@/lib/db/schema";

/** Upload a past or practice exam for this exam. Questions may be modelled on it. */
export async function POST(req: Request, ctx: RouteContext<"/api/exams/[id]/materials">) {
  const { id } = await ctx.params;
  const db = getDb();
  const exam = db.select().from(s.exams).where(eq(s.exams.id, id)).get();
  if (!exam) return fail("That exam no longer exists.", 404);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail("No file came with that request.");
  try {
    const row = await addFile(db, exam.projectId, { name: file.name, relPath: file.name, bytes: new Uint8Array(await file.arrayBuffer()), label: { type: "exam", week: null, reason: "Added in the exam room.", check: false } });
    if (row.status !== "done") return fail(row.error ?? "Margin couldn't read that file.", 400);
    attachMaterial(db, id, row.id);
    return Response.json({ fileId: row.id, name: row.name }, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
