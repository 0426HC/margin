import { and, eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { examSummarySchema } from "@/lib/ai/schemas/exam";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { createExam } from "@/lib/exam/service";
import type { ExamSummary } from "@/lib/exam/types";
import { addFile } from "@/lib/projects/service";
import { demoSeedSchema, importDemoSeed } from "./seed";

/**
 * The demo exam: a fictional final-exam sheet for the demo course (POL101, the Federalist Papers), committed with the demo data in
 * demo/exam/. No real course material. Its summary is pre-read, like the demo's layers, so the exam room works without the AI reading it;
 * the student still checks the summary before anything is generated.
 */
const DIR = path.join(process.cwd(), "demo", "exam");
export const DEMO_SHEET_NAME = "POL101 Final exam instructions.md";

export function demoExamSummary(): ExamSummary {
  return examSummarySchema.parse(JSON.parse(fs.readFileSync(path.join(DIR, "summary.json"), "utf8"))) as ExamSummary;
}

/** Open the demo course (made from the seed if it isn't there yet) and give it the demo exam, once. Returns where to go. */
export async function loadDemoExam(db: Db): Promise<{ projectId: string; examId: string }> {
  const seed = demoSeedSchema.parse(JSON.parse(fs.readFileSync(path.join(process.cwd(), "demo", "seed.json"), "utf8")));
  const projectId = importDemoSeed(db, seed);
  const existing = db
    .select({ id: s.exams.id })
    .from(s.exams)
    .innerJoin(s.files, eq(s.files.id, s.exams.sheetFileId))
    .where(and(eq(s.exams.projectId, projectId), eq(s.files.name, DEMO_SHEET_NAME)))
    .get();
  if (existing) return { projectId, examId: existing.id };
  const bytes = new Uint8Array(fs.readFileSync(path.join(DIR, DEMO_SHEET_NAME)));
  const file = await addFile(db, projectId, { name: DEMO_SHEET_NAME, relPath: `Exam/${DEMO_SHEET_NAME}`, bytes, label: { type: "exam", week: null, reason: "The demo course's exam sheet.", check: false } });
  if (file.status !== "done") throw new Error(file.error ?? "Margin couldn't read the demo exam sheet.");
  const examId = createExam(db, projectId, file.id, "final");
  db.update(s.exams).set({ summary: demoExamSummary(), confirmed: false }).where(eq(s.exams.id, examId)).run();
  return { projectId, examId };
}
