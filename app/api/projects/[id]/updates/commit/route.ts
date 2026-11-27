import { z } from "zod";
import { getEngine } from "@/lib/ai";
import { getDb } from "@/lib/db/client";
import { failure } from "@/lib/layers/http";
import { readBody } from "@/lib/projects/api";
import { refuseIfDemo } from "@/lib/projects/demo-guard";
import { eq, inArray } from "drizzle-orm";
import * as s from "@/lib/db/schema";
import { ensureExams } from "@/lib/exam/service";
import { kickBackground } from "@/lib/layers/background";
import { commitFiles, getPending, placeNewPassages } from "@/lib/updates/service";

export const maxDuration = 300;

const body = z.object({
  staged: z.array(z.object({ fileId: z.string(), replaces: z.string().optional() })).max(5000),
  removals: z.array(z.object({ fileId: z.string(), keep: z.boolean() })).max(5000),
});

/**
 * Put the approved files into the course (weeks, sections, passages), then place their passages: into existing layers, or into new
 * layers that are only proposed. Saved write-ups are never changed. The first step is all-or-nothing; if placing fails, the passages stay
 * unplaced and the same call can be made again.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/updates/commit">) {
  const { id } = await ctx.params;
  const db = getDb();
  const refused = refuseIfDemo(db, { projectId: id });
  if (refused) return refused;
  const b = await readBody(req, body);
  if ("error" in b) return b.error;
  try {
    // an exam sheet that is replaced by a changed one keeps its exam: it is read again, and the student checks the new summary
    const replaces = b.data.staged.flatMap((x) => (x.replaces ? [{ old: x.replaces, next: x.fileId }] : []));
    const replacedExams = replaces.length ? db.select({ id: s.exams.id, file: s.exams.sheetFileId }).from(s.exams).where(inArray(s.exams.sheetFileId, replaces.map((r) => r.old))).all() : [];
    const committed = commitFiles(db, id, b.data);
    for (const e of replacedExams) {
      const next = replaces.find((r) => r.old === e.file)?.next;
      if (next) db.update(s.exams).set({ sheetFileId: next, summary: null, confirmed: false }).where(eq(s.exams.id, e.id)).run();
    }
    ensureExams(db, id); // every exam sheet that arrived gets its exam
    const placed = await placeNewPassages(db, getEngine(), id, req.signal);
    kickBackground(); // a week whose lecture files changed has its Lecture tab written again
    return Response.json({ committed, placed, pending: getPending(db, id) });
  } catch (e) {
    return failure(e);
  }
}
