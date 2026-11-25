import { and, asc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "@/lib/db/client";
import { filesDir } from "@/lib/db/paths";
import * as s from "@/lib/db/schema";
import { fileKindOf, ImportError, parseFile } from "@/lib/import/parse";
import type { Engine } from "@/lib/ai/engine";
import { measure, openingBudget, readCourse, type Progress } from "@/lib/import/organize";
import { placementOf, type FileType } from "./file-kinds";
import { makePassages } from "@/lib/import/passages";
import { isLowQuality } from "@/lib/import/text-quality";
import { splitSections } from "@/lib/import/split-sections";
import type { FileRow, ReviewModel } from "./types";
import { sha256 } from "./hash";
import { ensureExams } from "@/lib/exam/service";
import { importNotesFile, removeImportedNotes, saveCourseWeeks, setCourseMapNote, unitPlan } from "./course-import";
import { copyReason, savePageRanges } from "./page-ranges";
import { tidyBrain } from "@/lib/brain/store";

const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const safeName = (n: string) => n.replace(/[^\w.-]+/g, "_");

export function createProject(db: Db, input: { name: string; courseCode?: string | null }) {
  const id = nanoid(10);
  db.insert(s.projects).values({ id, name: input.name.trim(), courseCode: input.courseCode?.trim() || null }).run();
  return id;
}

export { sha256 };

/** Store one uploaded file and read it. A file that cannot be read gets a `failed` row with a reason; it never stops the others. */
export async function addFile(db: Db, projectId: string, input: { name: string; relPath: string; bytes: Uint8Array; label?: { type: FileType; week: number | null; reason: string | null; check: boolean } }): Promise<FileRow> {
  const id = nanoid(10);
  // some uploads name the file by its whole path; keep only the file name
  const name = input.name.split(/[\\/]/).pop() || input.name;
  const kind = fileKindOf(name) ?? null;
  const l = input.label;
  const labelled = l ? { ...placementOf(l.type), type: l.type, week: l.type === "syllabus" ? null : l.week, reason: l.reason, needsCheck: l.check } : {};
  db.insert(s.files).values({ id, projectId, name, relPath: input.relPath, kind, status: "reading", contentHash: sha256(input.bytes), ...labelled }).run();
  try {
    const parsed = await parseFile(name, input.bytes);
    const dir = path.join(filesDir(), projectId);
    fs.mkdirSync(dir, { recursive: true });
    const storedPath = path.join(dir, `${id}-${safeName(name)}`);
    fs.writeFileSync(storedPath, input.bytes);
    db.update(s.files)
      .set({ status: "done", storedPath, pageKind: parsed.pageKind, pageCount: parsed.pageCount, parsed: parsed.blocks, runningHeaders: parsed.runningHeaders, textQuality: parsed.textQuality ?? null, author: parsed.author ?? null, pageOffset: parsed.printedOffset ?? null })
      .where(eq(s.files.id, id))
      .run();
  } catch (e) {
    const error = e instanceof ImportError ? e.message : "Margin couldn't read this file. Try opening and re-saving it, then add it again.";
    db.update(s.files).set({ status: "failed", error }).where(eq(s.files.id, id)).run();
  }
  return db.select({ id: s.files.id, name: s.files.name, relPath: s.files.relPath, status: s.files.status, error: s.files.error, pageCount: s.files.pageCount, pageKind: s.files.pageKind }).from(s.files).where(eq(s.files.id, id)).get()!;
}

/** Positions sections 0..n in a unit by file order, then reading order within each file. */
export function renumber(db: Db, unitId: string) {
  const rows = db
    .select({ id: s.sections.id, relPath: s.files.relPath, position: s.sections.position })
    .from(s.sections)
    .innerJoin(s.files, eq(s.files.id, s.sections.fileId))
    .where(eq(s.sections.unitId, unitId))
    .all()
    .sort((a, b) => natural.compare(a.relPath, b.relPath) || a.position - b.position);
  rows.forEach((r, i) => db.update(s.sections).set({ position: i }).where(eq(s.sections.id, r.id)).run());
}

/** Put a read file into a unit: cut it into sections and passages, starting at section position `pos`. Returns the next free position. Deterministic: no AI. */
export function indexFile(db: Db, projectId: string, unitId: string, f: typeof s.files.$inferSelect, pos: number): number {
  db.update(s.files).set({ unitId }).where(eq(s.files.id, f.id)).run();
  const sections = splitSections({ kind: f.kind!, pageKind: f.pageKind!, pageCount: f.pageCount ?? 0, blocks: f.parsed ?? [], runningHeaders: f.runningHeaders ?? [] });
  for (const sec of sections) {
    const sectionId = nanoid(10);
    db.insert(s.sections).values({ id: sectionId, projectId, unitId, fileId: f.id, position: pos++, title: sec.title, pageStart: sec.pageStart, pageEnd: sec.pageEnd, wordCount: sec.wordCount, original: sec.blocks }).run();
    for (const p of makePassages(sec)) db.insert(s.passages).values({ id: nanoid(10), projectId, fileId: f.id, sectionId, page: p.page, ordinal: p.ordinal, text: p.text }).run();
  }
  return pos;
}

/**
 * Sort the course folder. Exact copies (the same bytes) are set aside first; then the AI reads the syllabus, the folder tree and every
 * file's facts and says what the weeks are and what each file is (`lib/import/organize.ts`). Code then writes it: one unit per week,
 * course files, the syllabus and optional readings cut into sections and passages, the student's own notes copied into Lecture notes,
 * exam material sent to the exam room. If the AI's answer can't be used, the files stay unlabelled and the plan screen says why, so the
 * student can label them. Safe to run again before the plan is approved: it replaces what an earlier run made (notes are copied once).
 */
export async function analyzeProject(db: Db, engine: Engine, projectId: string, onProgress: Progress = () => {}, signal?: AbortSignal) {
  const project = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get();
  if (!project) return;
  const done = db.select().from(s.files).where(and(eq(s.files.projectId, projectId), eq(s.files.status, "done"))).all().sort((a, b) => natural.compare(a.relPath, b.relPath));

  // the same bytes twice (a reading saved in two folders): the first copy is read, the others are used through it
  const firstOf = new Map<string, string>();
  const copyOf = new Map<string, string>();
  for (const f of done) {
    const key = f.contentHash ?? f.id;
    const first = firstOf.get(key);
    if (first) copyOf.set(f.id, first);
    else firstOf.set(key, f.id);
  }
  const unique = done.filter((f) => !copyOf.has(f.id));

  onProgress(`Looking at ${unique.length === 1 ? "the file" : `the ${unique.length} files`} and the folder they came in`);
  const course = [project.courseCode, project.name].filter(Boolean).join(" · ");
  const result = await readCourse(
    engine,
    {
      course,
      allPaths: done.map((f) => f.relPath),
      files: unique.map((f) => {
        const read = { kind: f.kind!, pageKind: f.pageKind!, pageCount: f.pageCount ?? 0, blocks: f.parsed ?? [], author: f.author, pageOffset: f.pageOffset };
        const copies = done.filter((c) => copyOf.get(c.id) === f.id).map((c) => c.relPath);
        return { key: f.id, relPath: f.relPath, facts: { ...measure(read, openingBudget(unique.length)), copies }, text: read.blocks.map((b) => b.text).join("\n") };
      }),
    },
    onProgress,
    signal,
  );
  onProgress("Cutting the files into passages");

  db.transaction((tx) => {
    tx.delete(s.parts).where(eq(s.parts.projectId, projectId)).run(); // layers point at passages, so they go first
    tx.delete(s.units).where(eq(s.units.projectId, projectId)).run(); // cascades to sections and passages
    for (const f of done) {
      const copy = copyOf.get(f.id);
      const label = result.ok ? result.labels.get(copy ?? f.id) : undefined;
      if (copy) tx.update(s.files).set({ category: "duplicate", type: null, role: null, week: label?.week ?? null, reason: copyReason(label?.pages ?? []), needsCheck: false, unitId: null }).where(eq(s.files.id, f.id)).run();
      else if (label) tx.update(s.files).set({ ...placementOf(label.type), type: label.type, week: label.type === "syllabus" ? null : label.week, reason: label.reason, needsCheck: label.check, unitId: null }).where(eq(s.files.id, f.id)).run();
      else tx.update(s.files).set({ category: null, type: null, role: null, week: null, reason: null, needsCheck: false, unitId: null }).where(eq(s.files.id, f.id)).run();
    }
    saveCourseWeeks(tx, projectId, result.ok ? result.weeks : []);
    setCourseMapNote(
      tx,
      projectId,
      result.ok
        ? { failed: null, missingReadings: result.missingReadings, notInSyllabus: result.notInSyllabus, breaks: result.breaks, review: result.review }
        : { failed: result.message, missingReadings: [], notInSyllabus: [], breaks: [], review: [] },
    );

    const labelled = tx.select().from(s.files).where(and(eq(s.files.projectId, projectId), eq(s.files.status, "done"))).all();
    // one file the syllabus splits between weeks: each week gets its pages
    tx.delete(s.filePages).where(eq(s.filePages.projectId, projectId)).run();
    if (result.ok) for (const f of labelled) if (!copyOf.has(f.id)) savePageRanges(tx, projectId, f, result.labels.get(f.id)?.pages ?? []);
    const titles = new Map(result.ok ? result.weeks.filter((w) => w.title).map((w) => [w.week, w.title]) : []);
    unitPlan(labelled, titles).forEach((u, position) => {
      const unitId = nanoid(10);
      tx.insert(s.units).values({ id: unitId, projectId, title: u.title, position, isOverview: u.isOverview }).run();
      const unitFiles = labelled.filter((f) => u.fileIds.includes(f.id)).sort((a, b) => natural.compare(a.relPath, b.relPath));
      let pos = 0;
      for (const f of unitFiles) pos = indexFile(tx, projectId, unitId, f, pos);
    });

    // the student's own notes go into their week's Lecture notes, once; notes with no clear week wait until the student picks one
    const imported = new Set(tx.select({ f: s.noteImports.fileId }).from(s.noteImports).where(eq(s.noteImports.projectId, projectId)).all().map((r) => r.f));
    for (const f of labelled) {
      if (f.category === "notes" && f.week !== null && !imported.has(f.id)) importNotesFile(tx, projectId, f, f.week);
      else if (f.category !== "notes" && imported.has(f.id)) removeImportedNotes(tx, projectId, f); // read as notes before, not now
    }
    ensureExams(tx, projectId);

    const patch: Partial<typeof s.projects.$inferInsert> = { status: "building" };
    if (!project.courseCode && result.ok && result.courseCode) patch.courseCode = result.courseCode;
    tx.update(s.projects).set(patch).where(eq(s.projects.id, projectId)).run();
  });
  onProgress("Done");
}

export function getReview(db: Db, projectId: string): ReviewModel | null {
  const project = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get();
  if (!project) return null;
  const units = db.select().from(s.units).where(eq(s.units.projectId, projectId)).orderBy(asc(s.units.position)).all();
  const files = db.select().from(s.files).where(eq(s.files.projectId, projectId)).all();
  const sections = db
    .select({ id: s.sections.id, fileId: s.sections.fileId, position: s.sections.position, title: s.sections.title, pageStart: s.sections.pageStart, pageEnd: s.sections.pageEnd, wordCount: s.sections.wordCount })
    .from(s.sections)
    .where(eq(s.sections.projectId, projectId))
    .orderBy(asc(s.sections.position))
    .all();
  return {
    project: { id: project.id, name: project.name, courseCode: project.courseCode, status: project.status },
    units: units.map((u) => ({
      id: u.id,
      title: u.title,
      isOverview: u.isOverview,
      files: files
        .filter((f) => f.unitId === u.id)
        .sort((a, b) => natural.compare(a.relPath, b.relPath))
        .map((f) => ({
          id: f.id,
          name: f.name,
          relPath: f.relPath,
          kind: f.kind,
          pageKind: f.pageKind,
          textQuality: f.textQuality,
          lowQuality: isLowQuality(f.textQuality),
          sections: sections.filter((x) => x.fileId === f.id).map(({ id, title, pageStart, pageEnd, wordCount }) => ({ id, title, pageStart, pageEnd, wordCount })),
        })),
    })),
    failed: files.filter((f) => f.status === "failed").map((f) => ({ id: f.id, name: f.name, error: f.error ?? "" })),
  };
}

export function renameUnit(db: Db, unitId: string, title: string) {
  db.update(s.units).set({ title: title.trim() }).where(eq(s.units.id, unitId)).run();
}

/** Delete units that have no files left, and close the gaps in the unit order. */
export function tidyUnits(db: Db, projectId: string) {
  const units = db.select().from(s.units).where(eq(s.units.projectId, projectId)).orderBy(asc(s.units.position)).all();
  const used = new Set(db.select({ u: s.files.unitId }).from(s.files).where(eq(s.files.projectId, projectId)).all().map((r) => r.u));
  const keep = units.filter((u) => used.has(u.id));
  const drop = units.filter((u) => !used.has(u.id)).map((u) => u.id);
  if (drop.length) db.delete(s.units).where(inArray(s.units.id, drop)).run();
  keep.forEach((u, i) => db.update(s.units).set({ position: i }).where(eq(s.units.id, u.id)).run());
}

export function moveFile(db: Db, fileId: string, toUnitId: string) {
  db.transaction((tx) => {
    const file = tx.select().from(s.files).where(eq(s.files.id, fileId)).get();
    const target = tx.select().from(s.units).where(eq(s.units.id, toUnitId)).get();
    if (!file || !target || file.projectId !== target.projectId) throw new Error("Pick a unit from this project.");
    const from = file.unitId;
    tx.update(s.files).set({ unitId: toUnitId }).where(eq(s.files.id, fileId)).run();
    tx.update(s.sections).set({ unitId: toUnitId }).where(eq(s.sections.fileId, fileId)).run();
    renumber(tx, toUnitId);
    if (from) renumber(tx, from);
    tidyUnits(tx, file.projectId);
  });
}

export function mergeUnits(db: Db, fromId: string, intoId: string) {
  if (fromId === intoId) return;
  db.transaction((tx) => {
    const from = tx.select().from(s.units).where(eq(s.units.id, fromId)).get();
    const into = tx.select().from(s.units).where(eq(s.units.id, intoId)).get();
    if (!from || !into || from.projectId !== into.projectId) throw new Error("Pick two units from this project.");
    tx.update(s.files).set({ unitId: intoId }).where(eq(s.files.unitId, fromId)).run();
    tx.update(s.sections).set({ unitId: intoId }).where(eq(s.sections.unitId, fromId)).run();
    renumber(tx, intoId);
    tidyUnits(tx, from.projectId);
  });
}

export function removeFile(db: Db, fileId: string) {
  db.transaction((tx) => {
    const file = tx.select().from(s.files).where(eq(s.files.id, fileId)).get();
    if (!file) return;
    tx.delete(s.files).where(eq(s.files.id, fileId)).run(); // cascades to sections and passages
    if (file.storedPath) fs.rmSync(file.storedPath, { force: true });
    if (file.unitId) renumber(tx, file.unitId);
    tidyUnits(tx, file.projectId);
    tidyBrain(tx, file.projectId);
  });
}

/** The unit review is done. Next each week's layers are proposed and approved; only then is the project ready. */
export function finishReview(db: Db, projectId: string) {
  db.update(s.projects).set({ status: "building" }).where(and(eq(s.projects.id, projectId), eq(s.projects.status, "reviewing"))).run();
}
