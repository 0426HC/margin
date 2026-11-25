import { eq } from "drizzle-orm";
import fs from "node:fs";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { applyExamUpdate } from "@/lib/exam/service";
import { failure } from "@/lib/layers/http";
import { fail } from "@/lib/projects/api";
import { addFile } from "@/lib/projects/service";

/**
 * "Confirm changes": save the new exam details as a new version. An updated sheet, if one came with them, is stored now (and only now) as
 * the exam's sheet; past attempts stay with the version they were sat under.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/exams/[id]/update">) {
  const { id } = await ctx.params;
  const db = getDb();
  const exam = db.select().from(s.exams).where(eq(s.exams.id, id)).get();
  if (!exam) return fail("That exam no longer exists. Reload the page.", 404);
  const form = await req.formData().catch(() => null);
  let summary: unknown;
  try {
    summary = JSON.parse(String(form?.get("summary") ?? ""));
  } catch {
    return fail("The details didn't arrive. Try Confirm changes again.");
  }
  const note = String(form?.get("note") ?? "");
  const file = form?.get("file");
  let stored: { id: string } | null = null;
  try {
    if (file instanceof File && file.size) {
      const row = await addFile(db, exam.projectId, { name: file.name, relPath: file.name, bytes: new Uint8Array(await file.arrayBuffer()), label: { type: "exam", week: null, reason: "Added in the exam room.", check: false } });
      if (row.status !== "done") return fail(row.error ?? "Margin couldn't read that sheet.");
      stored = row;
    }
    return Response.json(applyExamUpdate(db, id, summary, { note, sheetFileId: stored?.id ?? null }));
  } catch (e) {
    // nothing is kept when the update itself fails: not even the sheet that came with it
    if (stored) {
      const f = db.select().from(s.files).where(eq(s.files.id, stored.id)).get();
      db.delete(s.files).where(eq(s.files.id, stored.id)).run();
      if (f?.storedPath) fs.rmSync(f.storedPath, { force: true });
    }
    return failure(e);
  }
}
