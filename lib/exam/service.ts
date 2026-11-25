import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import fs from "node:fs";
import { invalidCitations, stripInvalidCitations } from "@/lib/ai/citations";
import type { Engine } from "@/lib/ai/engine";
import { BadStructuredOutput } from "@/lib/ai/errors";
import { examine, readSheet, updateDetails, writeQuestions } from "@/lib/ai/tasks";
import { examSummarySchema } from "@/lib/ai/schemas";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { StructureError } from "@/lib/layers/service";
import { examKindOf } from "@/lib/updates/classify";
import { getCourseWeeks } from "@/lib/updates/service";
import { checkQuestions, markChoice, planQuestions, sourcesFor, tally } from "./plan";
import { gatherSources } from "./sources";
import type { ExamFeedback, ExamQuestion, ExamSource, ExamSummary } from "./types";

/** Something the student can fix: a plain message, shown as is (HTTP 400). */
export class ExamError extends StructureError {}

const TITLES = { midterm: "Midterm", final: "Final", exam: "Exam" } as const;
const SHEET_CHARS = 16_000;

// ---------------------------------------------------------------- the exams of a project

/**
 * Every exam instruction sheet a project holds has an exam of its own. Sheets arrive as files labelled "exam" (from What's new or from
 * "Add exam sheet"); any that has no exam yet, and is not a past exam the student attached to one, gets one here.
 */
export function ensureExams(db: Db, projectId: string): void {
  const linked = new Set([
    ...db.select({ f: s.exams.sheetFileId }).from(s.exams).where(eq(s.exams.projectId, projectId)).all().flatMap((r) => (r.f ? [r.f] : [])),
    ...db.select({ f: s.examMaterials.fileId }).from(s.examMaterials).innerJoin(s.exams, eq(s.exams.id, s.examMaterials.examId)).where(eq(s.exams.projectId, projectId)).all().map((r) => r.f),
    // an updated sheet, and the sheet an earlier version was read from, belong to their exam too
    ...db.select({ f: s.examVersions.sheetFileId }).from(s.examVersions).innerJoin(s.exams, eq(s.exams.id, s.examVersions.examId)).where(eq(s.exams.projectId, projectId)).all().flatMap((r) => (r.f ? [r.f] : [])),
  ]);
  const sheets = db.select().from(s.files).where(and(eq(s.files.projectId, projectId), eq(s.files.role, "exam"), eq(s.files.status, "done"))).all();
  for (const f of sheets) if (!linked.has(f.id)) createExam(db, projectId, f.id);
}

/** Make an exam for a stored sheet. Midterm or Final comes from the file's name and first words; a second of a kind is numbered. */
export function createExam(db: Db, projectId: string, fileId: string, kind?: "midterm" | "final" | "exam"): string {
  const f = db.select().from(s.files).where(and(eq(s.files.id, fileId), eq(s.files.projectId, projectId))).get();
  if (!f) throw new ExamError("That file isn't in this project.");
  const k = kind ?? examKindOf(f.name, (f.parsed ?? []).map((b) => b.text).join("\n"));
  const same = db.select({ n: sql<number>`count(*)` }).from(s.exams).where(and(eq(s.exams.projectId, projectId), eq(s.exams.kind, k))).get()!.n;
  const id = nanoid(10);
  db.insert(s.exams).values({ id, projectId, sheetFileId: fileId, kind: k, title: same ? `${TITLES[k]} ${same + 1}` : TITLES[k] }).run();
  return id;
}

export interface ExamListItem {
  id: string;
  kind: "midterm" | "final" | "exam";
  title: string;
  /** Where the exam stands: the sheet still to be read, the summary waiting for the student to check it, or ready to practise. */
  status: "unread" | "check" | "ready";
  sets: number;
  attempts: number;
  /** The last handed-in attempt: marks earned of marks available. */
  last: { earned: number; total: number } | null;
}

export function listExams(db: Db, projectId: string): ExamListItem[] {
  ensureExams(db, projectId);
  return db
    .select()
    .from(s.exams)
    .where(eq(s.exams.projectId, projectId))
    .orderBy(asc(s.exams.createdAt), sql`rowid`)
    .all()
    .map((e) => {
      const sets = db.select({ id: s.examSets.id }).from(s.examSets).where(eq(s.examSets.examId, e.id)).all().map((r) => r.id);
      const attempts = sets.length ? db.select().from(s.examAttempts).where(inArray(s.examAttempts.setId, sets)).orderBy(desc(s.examAttempts.startedAt)).all() : [];
      const done = attempts.find((a) => a.feedback);
      return { id: e.id, kind: e.kind, title: e.title, status: !e.summary ? "unread" : e.confirmed ? "ready" : "check", sets: sets.length, attempts: attempts.length, last: done?.feedback ? { earned: done.feedback.earned, total: done.feedback.total } : null };
    });
}

export interface ExamSetView {
  id: string;
  number: number;
  questions: ExamQuestion[];
  planned: number;
  minutes: number | null;
}
export interface AttemptView {
  id: string;
  setId: string;
  timer: "real" | "none";
  startedAt: number;
  deadline: number | null;
  handedInAt: number | null;
  answers: Record<string, string>;
  feedback: ExamFeedback | null;
}
/** One sitting, for the list of attempts. `oldFormat`: sat under an earlier version of the exam's details. */
export interface AttemptRow {
  id: string;
  setNumber: number;
  startedAt: number;
  handedInAt: number | null;
  earned: number | null;
  total: number | null;
  version: number;
  oldFormat: boolean;
}
export interface ExamView {
  id: string;
  projectId: string;
  kind: "midterm" | "final" | "exam";
  title: string;
  hasSheet: boolean;
  sheetName: string | null;
  summary: ExamSummary | null;
  confirmed: boolean;
  materials: { fileId: string; name: string }[];
  /** The newest set, its newest attempt, and how many sets there have been. */
  set: ExamSetView | null;
  attempt: AttemptView | null;
  setCount: number;
  courseWeeks: number;
  /** The current version of the exam's details (1 until the student updates them). */
  version: number;
  /** Every attempt at this exam, newest first, each with the version it was sat under. */
  attempts: AttemptRow[];
}

const attemptView = (a: typeof s.examAttempts.$inferSelect): AttemptView => ({ id: a.id, setId: a.setId, timer: a.timer, startedAt: a.startedAt, deadline: a.deadline, handedInAt: a.handedInAt, answers: a.answers, feedback: a.feedback });

export function getExamView(db: Db, examId: string): ExamView | null {
  const e = db.select().from(s.exams).where(eq(s.exams.id, examId)).get();
  if (!e) return null;
  const sheet = e.sheetFileId ? db.select({ name: s.files.name }).from(s.files).where(eq(s.files.id, e.sheetFileId)).get() : undefined;
  const materials = db.select({ fileId: s.files.id, name: s.files.name }).from(s.examMaterials).innerJoin(s.files, eq(s.files.id, s.examMaterials.fileId)).where(eq(s.examMaterials.examId, examId)).all();
  const sets = db.select().from(s.examSets).where(eq(s.examSets.examId, examId)).orderBy(desc(s.examSets.number)).all();
  // after "Update exam details", a set written for the old format is not offered again: new practice uses the new version
  const set = sets[0] && sets[0].version === e.version ? sets[0] : undefined;
  const attempt = set ? db.select().from(s.examAttempts).where(eq(s.examAttempts.setId, set.id)).orderBy(desc(s.examAttempts.startedAt), sql`rowid desc`).get() : undefined;
  const bySet = new Map(sets.map((x) => [x.id, x]));
  const attempts: AttemptRow[] = sets.length
    ? db
        .select()
        .from(s.examAttempts)
        .where(inArray(s.examAttempts.setId, sets.map((x) => x.id)))
        .orderBy(desc(s.examAttempts.startedAt), sql`rowid desc`)
        .all()
        .map((a) => {
          const of = bySet.get(a.setId)!;
          return { id: a.id, setNumber: of.number, startedAt: a.startedAt, handedInAt: a.handedInAt, earned: a.feedback?.earned ?? null, total: a.feedback?.total ?? null, version: of.version, oldFormat: of.version < e.version };
        })
    : [];
  return {
    id: e.id,
    projectId: e.projectId,
    kind: e.kind,
    title: e.title,
    hasSheet: !!sheet,
    sheetName: sheet?.name ?? null,
    summary: e.summary,
    confirmed: e.confirmed,
    materials,
    set: set ? { id: set.id, number: set.number, questions: set.questions, planned: set.planned, minutes: set.minutes } : null,
    attempt: attempt ? attemptView(attempt) : null,
    setCount: sets.length,
    courseWeeks: getCourseWeeks(db, e.projectId).count,
    version: e.version,
    attempts,
  };
}

function load(db: Db, examId: string) {
  const e = db.select().from(s.exams).where(eq(s.exams.id, examId)).get();
  if (!e) throw new ExamError("That exam no longer exists. Reload the page.");
  return e;
}

// ---------------------------------------------------------------- reading the sheet

const inflight = new Map<string, Promise<unknown>>();
const once = <T>(key: string, run: () => Promise<T>): Promise<T> => {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const job = run().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
};

/** Read the sheet into a summary for the student to check. Reading again replaces a summary the student has not yet confirmed (or asks to start over). */
export function readExamSummary(db: Db, engine: Engine, examId: string, signal?: AbortSignal): Promise<ExamSummary> {
  const e = load(db, examId);
  return once(`read:${examId}`, async () => {
    const f = e.sheetFileId ? db.select().from(s.files).where(eq(s.files.id, e.sheetFileId)).get() : undefined;
    if (!f?.parsed?.length) throw new ExamError("Margin has no sheet to read for this exam. Add the exam sheet first.");
    const text = f.parsed.map((b) => b.text).join("\n").slice(0, SHEET_CHARS);
    const summary = await readSheet(engine, { fileName: f.name, text, courseWeeks: getCourseWeeks(db, e.projectId).count }, signal);
    db.update(s.exams).set({ summary, confirmed: false }).where(eq(s.exams.id, examId)).run();
    return summary;
  });
}

/** Save the student's checked or edited summary. `confirm` says it is right: only then can a set be generated. */
export function saveExamSummary(db: Db, examId: string, input: unknown, confirm: boolean): ExamSummary {
  const e = load(db, examId);
  const parsed = examSummarySchema.safeParse(input);
  if (!parsed.success) throw new ExamError(`The summary can't be saved: ${parsed.error.issues.map((i) => `${i.path.join(".") || "summary"} ${i.message}`).slice(0, 3).join("; ")}.`);
  const title = parsed.data.title;
  db.update(s.exams).set({ summary: parsed.data, confirmed: confirm, title }).where(eq(s.exams.id, e.id)).run();
  return parsed.data;
}

// ---------------------------------------------------------------- updating the exam's details

/**
 * Read an updated sheet and/or a note of what the student heard, and propose the exam's details with those changes. Nothing is saved: the
 * student sees every change, can edit it, and only "Confirm changes" (applyExamUpdate) keeps it.
 */
export async function proposeExamUpdate(db: Db, engine: Engine, examId: string, input: { note: string; sheet: { fileName: string; text: string } | null }, signal?: AbortSignal): Promise<ExamSummary> {
  const e = load(db, examId);
  if (!e.summary) throw new ExamError("Set up the exam first: Margin needs its current details to update them.");
  if (!input.note.trim() && !input.sheet?.text.trim()) throw new ExamError("Add an updated sheet or write what changed, then Margin can read it.");
  const sheet = input.sheet ? { fileName: input.sheet.fileName, text: input.sheet.text.slice(0, SHEET_CHARS) } : null;
  return updateDetails(engine, { current: e.summary, sheet, note: input.note.slice(0, 2000), courseWeeks: getCourseWeeks(db, e.projectId).count }, signal);
}

/**
 * Save new exam details as a new version. The details before are kept as the earlier version (with the sheet they came from), past attempts
 * stay linked to the version their set was written for, and the next practice set is written for the new one.
 */
export function applyExamUpdate(db: Db, examId: string, input: unknown, opts: { note?: string | null; sheetFileId?: string | null } = {}): { summary: ExamSummary; version: number } {
  const e = load(db, examId);
  if (!e.summary || !e.confirmed) throw new ExamError("Set up the exam first, then you can update its details.");
  const parsed = examSummarySchema.safeParse(input);
  if (!parsed.success) throw new ExamError(`The details can't be saved: ${parsed.error.issues.map((i) => `${i.path.join(".") || "details"} ${i.message}`).slice(0, 3).join("; ")}.`);
  const next = e.version + 1;
  db.transaction((tx) => {
    const kept = tx.select({ id: s.examVersions.id }).from(s.examVersions).where(and(eq(s.examVersions.examId, examId), eq(s.examVersions.number, e.version))).get();
    if (!kept) tx.insert(s.examVersions).values({ id: nanoid(10), examId, number: e.version, summary: e.summary!, sheetFileId: e.sheetFileId }).run();
    tx.insert(s.examVersions).values({ id: nanoid(10), examId, number: next, summary: parsed.data, sheetFileId: opts.sheetFileId ?? e.sheetFileId, note: opts.note?.trim() || null }).run();
    tx.update(s.exams)
      .set({ summary: parsed.data, title: parsed.data.title, version: next, confirmed: true, ...(opts.sheetFileId ? { sheetFileId: opts.sheetFileId } : {}) })
      .where(eq(s.exams.id, examId))
      .run();
  });
  return { summary: parsed.data, version: next };
}

// ---------------------------------------------------------------- past and practice exams

export function attachMaterial(db: Db, examId: string, fileId: string) {
  load(db, examId);
  db.insert(s.examMaterials).values({ examId, fileId }).onConflictDoNothing().run();
}

/** Remove an uploaded past exam: the file, its text and its link, for good. */
export function removeMaterial(db: Db, examId: string, fileId: string) {
  load(db, examId);
  const f = db.select().from(s.files).where(eq(s.files.id, fileId)).get();
  if (!f) return;
  db.delete(s.files).where(eq(s.files.id, fileId)).run(); // its link goes with it
  if (f.storedPath) fs.rmSync(f.storedPath, { force: true });
}

/** Delete an exam for good: its sheets (every version's) and uploaded exams (files and text), its versions, sets, attempts and feedback. */
export function deleteExam(db: Db, examId: string): boolean {
  const e = db.select().from(s.exams).where(eq(s.exams.id, examId)).get();
  if (!e) return false;
  const fileIds = [
    ...new Set([
      ...(e.sheetFileId ? [e.sheetFileId] : []),
      ...db.select({ f: s.examMaterials.fileId }).from(s.examMaterials).where(eq(s.examMaterials.examId, examId)).all().map((r) => r.f),
      ...db.select({ f: s.examVersions.sheetFileId }).from(s.examVersions).where(eq(s.examVersions.examId, examId)).all().flatMap((r) => (r.f ? [r.f] : [])),
    ]),
  ];
  const files = fileIds.length ? db.select().from(s.files).where(inArray(s.files.id, fileIds)).all() : [];
  db.transaction((tx) => {
    tx.delete(s.exams).where(eq(s.exams.id, examId)).run(); // sets, attempts and links go with it
    if (fileIds.length) tx.delete(s.files).where(inArray(s.files.id, fileIds)).run();
  });
  for (const f of files) if (f.storedPath) fs.rmSync(f.storedPath, { force: true });
  return true;
}

// ---------------------------------------------------------------- generating a set

/**
 * Write a practice exam in the sheet's real format. Nothing is written before the student has confirmed the summary. A "new" set avoids
 * the questions and the pages of the earlier ones and leans toward weaker layers. The model writes; code checks the counts, the options and
 * every citation against what was sent, retrying once with the reasons.
 */
export function generateSet(db: Db, engine: Engine, examId: string, signal?: AbortSignal): Promise<ExamSetView> {
  const e = load(db, examId);
  if (!e.summary) throw new ExamError("Read the exam sheet first.");
  if (!e.confirmed) throw new ExamError("Check the summary of the sheet first, then say it looks right. Nothing is written before you do.");
  const summary = e.summary;
  return once(`set:${examId}`, async () => {
    const earlier = db.select().from(s.examSets).where(eq(s.examSets.examId, examId)).orderBy(asc(s.examSets.number)).all();
    const avoid = earlier.flatMap((set) => set.questions.map((q) => q.prompt));
    const used = new Set(earlier.flatMap((set) => set.questions.flatMap((q) => q.builtFrom.flatMap((o) => [...o.cite.matchAll(/\[([^\]\n]+), p\. (\d+)\]/g)].map((m) => `${m[1]}\u0000${m[2]}`)))));
    const plan = planQuestions(summary);
    const g = gatherSources(db, e, summary, used);
    if (!g.sources.length) throw new ExamError("There is nothing to build questions from yet: add the exam sheet, or files for the weeks it covers.");
    let feedback: string | undefined;
    let result: ReturnType<typeof checkQuestions> | null = null;
    for (let attempt = 0; attempt < 2 && !result; attempt++) {
      try {
        const out = await writeQuestions(engine, { summary, plan: plan.rows, stressed: g.stressed, sources: g.sources, avoid: avoid.slice(-40), weaker: g.weaker, feedback }, signal);
        const checked = checkQuestions(out, plan, g.sources, avoid);
        if (!checked.errors.length) result = checked;
        else feedback = checked.errors.slice(0, 6).join(" ");
      } catch (err) {
        if (!(err instanceof BadStructuredOutput)) throw err; // a missing or logged-out claude is not an invalid answer
        feedback = "It did not match the required JSON shape.";
      }
    }
    if (!result) throw new ExamError("Margin couldn't get a valid practice exam from Claude this time. Try again in a moment.");
    const id = nanoid(10);
    const number = (earlier.at(-1)?.number ?? 0) + 1;
    // keep only the sources the questions cite: that is what feedback may cite
    const cited = new Set(result.questions.flatMap((q) => q.builtFrom.flatMap((o) => [...o.cite.matchAll(/\[([^\]\n]+), p\. (\d+)\]/g)].map((m) => `${m[1]}\u0000${m[2]}`))));
    const sources: ExamSource[] = g.sources.filter((x) => cited.has(`${x.file}\u0000${x.page}`));
    db.insert(s.examSets).values({ id, examId, number, questions: result.questions, sources, planned: plan.planned, minutes: plan.minutes, version: e.version }).run();
    return { id, number, questions: result.questions, planned: plan.planned, minutes: plan.minutes };
  });
}

// ---------------------------------------------------------------- sitting it

export function startAttempt(db: Db, setId: string, timer: "real" | "none"): AttemptView {
  const set = db.select().from(s.examSets).where(eq(s.examSets.id, setId)).get();
  if (!set) throw new ExamError("That practice exam no longer exists. Reload the page.");
  const now = Date.now();
  const deadline = timer === "real" && set.minutes ? now + set.minutes * 60_000 : null;
  const id = nanoid(10);
  db.insert(s.examAttempts).values({ id, setId, timer: deadline ? "real" : "none", startedAt: now, deadline, answers: {} }).run();
  return attemptView(db.select().from(s.examAttempts).where(eq(s.examAttempts.id, id)).get()!);
}

/** Autosave the answers. Ignored once the attempt is handed in. Only answers to this set's questions are kept. */
export function saveAnswers(db: Db, attemptId: string, answers: Record<string, string>): void {
  const a = db.select().from(s.examAttempts).where(eq(s.examAttempts.id, attemptId)).get();
  if (!a) throw new ExamError("That attempt no longer exists. Reload the page.");
  if (a.handedInAt) return;
  const ids = new Set(db.select().from(s.examSets).where(eq(s.examSets.id, a.setId)).get()!.questions.map((q) => q.id));
  const kept = Object.fromEntries(Object.entries(answers).filter(([k, v]) => ids.has(k) && typeof v === "string").map(([k, v]) => [k, v.slice(0, 20_000)]));
  db.update(s.examAttempts).set({ answers: kept }).where(eq(s.examAttempts.id, attemptId)).run();
}

/**
 * Hand in. Multiple choice is marked by code; every other answered question is reviewed by the Examiner against the sheet's marking guide,
 * with citations checked against the sources the question was built from. Unanswered questions are skipped, not marked down. Handing in early is fine.
 */
export function handIn(db: Db, engine: Engine, attemptId: string, answers?: Record<string, string>, signal?: AbortSignal): Promise<AttemptView> {
  const a0 = db.select().from(s.examAttempts).where(eq(s.examAttempts.id, attemptId)).get();
  if (!a0) throw new ExamError("That attempt no longer exists. Reload the page.");
  if (a0.handedInAt) return Promise.resolve(attemptView(a0));
  if (answers) saveAnswers(db, attemptId, answers);
  return once(`hand:${attemptId}`, async () => {
    const a = db.select().from(s.examAttempts).where(eq(s.examAttempts.id, attemptId)).get()!;
    const set = db.select().from(s.examSets).where(eq(s.examSets.id, a.setId)).get()!;
    const exam = db.select().from(s.exams).where(eq(s.exams.id, set.examId)).get()!;
    const results = new Map(set.questions.map((q) => [q.id, null as ReturnType<typeof markChoice> | null]));
    const toExamine = set.questions.filter((q) => q.format !== "multiple_choice" && (a.answers[q.id] ?? "").trim());
    for (const q of set.questions) {
      if (q.format === "multiple_choice") results.set(q.id, markChoice(q, a.answers[q.id]));
      else if (!(a.answers[q.id] ?? "").trim()) results.set(q.id, { id: q.id, status: "skipped", marksAwarded: 0, marks: q.marks, by: "examiner", strengths: "", fixes: [] });
    }
    if (toExamine.length) {
      const sent = [...new Map(toExamine.flatMap((q) => sourcesFor(q, set.sources)).map((x) => [`${x.file}\u0000${x.page}`, x])).values()];
      const out = await examine(engine, { markingGuide: exam.summary?.markingGuide ?? "", sources: sent.map(({ file, page, text }) => ({ file, page, text })), questions: toExamine.map((q) => ({ id: q.id, prompt: q.prompt, marks: q.marks, keyPoints: q.keyPoints, answer: a.answers[q.id] })) }, signal);
      const byId = new Map(out.results.map((r) => [r.id, r]));
      for (const q of toExamine) {
        const r = byId.get(q.id);
        const clean = (t: string) => stripInvalidCitations(t, sent).text;
        results.set(q.id, {
          id: q.id,
          status: "marked",
          marksAwarded: Math.max(0, Math.min(q.marks, Math.round((r?.marksAwarded ?? 0) * 2) / 2)),
          marks: q.marks,
          by: "examiner",
          strengths: clean(r?.strengths ?? ""),
          fixes: (r?.fixes ?? ["The Examiner gave no feedback on this answer."]).map(clean).filter((t) => t && invalidCitations(t, sent).length === 0),
        });
      }
    }
    const feedback = tally(set.questions.map((q) => results.get(q.id)!), set.questions);
    db.update(s.examAttempts).set({ handedInAt: Date.now(), feedback }).where(eq(s.examAttempts.id, attemptId)).run();
    return attemptView(db.select().from(s.examAttempts).where(eq(s.examAttempts.id, attemptId)).get()!);
  });
}

