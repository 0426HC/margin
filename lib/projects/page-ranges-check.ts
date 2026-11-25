/**
 * Courses imported before Margin split one file's pages between weeks (`page-ranges.ts`): checked once each, in the background.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import fs from "node:fs";
import type { Engine } from "@/lib/ai/engine";
import { BadStructuredOutput } from "@/lib/ai/errors";
import { readPageRanges } from "@/lib/ai/tasks";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { checkPages, measure, syllabusText, type PageRange } from "@/lib/import/organize";
import { parseFile } from "@/lib/import/parse";
import { printedSpan } from "@/lib/import/printed-pages";
import { passageWeeks } from "@/lib/layers/passage-weeks";
import { afterPassagesLeft } from "@/lib/updates/service";
import { courseWeekCount } from "@/lib/weeks/count";
import { courseWeekRows } from "./course-import";
import { copyReason, savePageRanges } from "./page-ranges";

type FileRow = typeof s.files.$inferSelect;


const DONE_KEY = "page-ranges-checked";

/** Courses with exact copies whose page ranges haven't been checked yet (imported before the rule). The demo never needs it. */
export function coursesToCheck(db: Db): string[] {
  const done = new Set(db.select({ p: s.uiState.projectId }).from(s.uiState).where(eq(s.uiState.key, DONE_KEY)).all().map((r) => r.p));
  const withCopies = db
    .select({ p: s.files.projectId })
    .from(s.files)
    .innerJoin(s.projects, eq(s.projects.id, s.files.projectId))
    .where(and(eq(s.files.category, "duplicate"), eq(s.projects.isDemo, false), inArray(s.projects.status, ["building", "ready"])))
    .all()
    .map((r) => r.p);
  return [...new Set(withCopies)].filter((p) => !done.has(p));
}

const markChecked = (db: Db, projectId: string) =>
  db.insert(s.uiState).values({ id: `${projectId}:${DONE_KEY}`, projectId, key: DONE_KEY, value: true }).onConflictDoUpdate({ target: [s.uiState.projectId, s.uiState.key], set: { value: true } }).run();

/** A stored PDF's printed page numbers, read again from the file kept on disk (files imported before Margin looked for them). */
async function readOffset(f: FileRow): Promise<number | null> {
  if (f.kind !== "pdf" || !f.storedPath || !fs.existsSync(f.storedPath)) return f.pageOffset;
  try {
    return (await parseFile(f.name, new Uint8Array(fs.readFileSync(f.storedPath)))).printedOffset ?? null;
  } catch {
    return null;
  }
}

/**
 * Check one course imported before the rule: Claude reads its syllabus and the files saved in more than one folder and gives each week's
 * pages, checked by code like at import. Passages that now belong to another week leave their old layer (which shows "New material")
 * and are placed into the new week's layers by `place`, the same placement new files get. Marked done once it has run, even when no file
 * is split, so it runs once per course. Throws what the engine throws (the usage limit), so the caller can try again later.
 */
export async function checkCoursePages(
  db: Db,
  engine: Engine,
  projectId: string,
  place: (db: Db, engine: Engine, projectId: string) => Promise<unknown>,
  signal?: AbortSignal,
): Promise<{ split: number; moved: number }> {
  const project = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get();
  if (!project) return { split: 0, moved: 0 };
  const files = db.select().from(s.files).where(and(eq(s.files.projectId, projectId), eq(s.files.status, "done"))).all();
  const copies = files.filter((f) => f.category === "duplicate");
  const mains = files.filter((f) => f.category === "course" && copies.some((c) => c.contentHash && c.contentHash === f.contentHash));
  const syllabus = files.filter((f) => f.category === "syllabus").map((f) => ({ path: f.relPath, text: syllabusText(f.parsed ?? []) }));
  if (!mains.length || !syllabus.length) {
    markChecked(db, projectId);
    return { split: 0, moved: 0 };
  }
  for (const f of mains) {
    const offset = await readOffset(f);
    if (offset !== f.pageOffset) db.update(s.files).set({ pageOffset: offset }).where(eq(s.files.id, f.id)).run();
    f.pageOffset = offset;
  }
  // a course imported before Margin kept the syllabus's weeks has only its week count: weeks 1 to that, untitled
  const stored = courseWeekRows(db, projectId);
  const count = courseWeekCount(db, projectId) ?? 0;
  const weeks = stored.length ? stored : Array.from({ length: count }, (_, i) => ({ week: i + 1, date: null, title: "", kind: "class" as const }));
  const listed = mains.map((f, i) => {
    const facts = measure({ kind: f.kind!, pageKind: f.pageKind!, pageCount: f.pageCount ?? 0, blocks: f.parsed ?? [], author: f.author, pageOffset: f.pageOffset }, 200);
    return { id: `F${i + 1}`, path: f.relPath, ...facts, week: f.week, copies: copies.filter((c) => c.contentHash === f.contentHash).map((c) => c.relPath) };
  });
  const spans = new Map(listed.map((l, i) => [l.id, printedSpan(mains[i].pageCount ?? 1, mains[i].pageOffset)]));
  const course = [project.courseCode, project.name].filter(Boolean).join(" · ");
  const weekNos = new Set(weeks.map((w) => w.week));

  let answer: { file: string; pages: PageRange[] }[] | null = null;
  let feedback: string | undefined;
  for (let attempt = 0; attempt < 2 && !answer; attempt++) {
    try {
      const got = await readPageRanges(engine, { course, syllabus, weeks: weeks.map((w) => ({ week: w.week, date: w.date, title: w.title, kind: w.kind })), files: listed, feedback }, signal);
      const mine = got.files.filter((f) => spans.has(f.file));
      const problems = checkPages(mine, weekNos, "the course's weeks", spans);
      if (!problems.length) answer = mine;
      else feedback = problems.slice(0, 8).join(" ");
    } catch (e) {
      if (!(e instanceof BadStructuredOutput)) throw e;
      feedback = "The answer did not match the required JSON shape.";
    }
  }
  if (!answer) {
    console.log(`[margin pages] ${projectId}: Claude's page ranges didn't fit twice, so the course stays as it was`);
    markChecked(db, projectId);
    return { split: 0, moved: 0 };
  }

  let moved = 0;
  db.transaction((tx) => {
    for (const a of answer!) {
      const f = mains[listed.findIndex((l) => l.id === a.file)];
      savePageRanges(tx, projectId, f, a.pages);
      for (const c of copies.filter((x) => x.contentHash === f.contentHash)) tx.update(s.files).set({ reason: copyReason(a.pages.length >= 2 ? a.pages : []) }).where(eq(s.files.id, c.id)).run();
    }
    // passages now of another week leave the layer they were in
    const weekOf = passageWeeks(tx, projectId);
    const placed = tx
      .select({ passageId: s.layerPassages.passageId, layerId: s.layerPassages.layerId, week: s.parts.week })
      .from(s.layerPassages)
      .innerJoin(s.layers, eq(s.layers.id, s.layerPassages.layerId))
      .innerJoin(s.parts, eq(s.parts.id, s.layers.partId))
      .innerJoin(s.passages, eq(s.passages.id, s.layerPassages.passageId))
      .where(and(eq(s.parts.projectId, projectId), inArray(s.passages.fileId, mains.map((f) => f.id))))
      .all();
    const leaving = placed.filter((p) => p.week !== null && weekOf.has(p.passageId) && weekOf.get(p.passageId) !== p.week);
    moved = leaving.length;
    if (!moved) return;
    for (const p of leaving) tx.delete(s.layerPassages).where(eq(s.layerPassages.passageId, p.passageId)).run();
    afterPassagesLeft(tx, [...new Set(leaving.map((p) => p.layerId))]);
  });
  if (moved) await place(db, engine, projectId);
  markChecked(db, projectId);
  const split = db.select({ n: sql<number>`count(distinct ${s.filePages.fileId})` }).from(s.filePages).where(eq(s.filePages.projectId, projectId)).get()!.n;
  console.log(`[margin pages] ${projectId}: ${split} file(s) split between weeks, ${moved} passage(s) moved`);
  return { split, moved };
}

