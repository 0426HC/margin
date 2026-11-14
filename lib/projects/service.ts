import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "@/lib/db/client";
import { filesDir } from "@/lib/db/paths";
import * as s from "@/lib/db/schema";
import { detectCourseCode, detectUnits } from "@/lib/import/detect-units";
import { fileKindOf, ImportError, parseFile } from "@/lib/import/parse";
import { makePassages } from "@/lib/import/passages";
import { isLowQuality } from "@/lib/import/text-quality";
import { splitSections } from "@/lib/import/split-sections";
import type { FileRow, ReviewModel } from "./types";

const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const safeName = (n: string) => n.replace(/[^\w.-]+/g, "_");

export function createProject(db: Db, input: { name: string; courseCode?: string | null }) {
  const id = nanoid(10);
  db.insert(s.projects).values({ id, name: input.name.trim(), courseCode: input.courseCode?.trim() || null }).run();
  return id;
}

/** Store one uploaded file and read it. A file that cannot be read gets a `failed` row with a reason; it never stops the others. */
export async function addFile(db: Db, projectId: string, input: { name: string; relPath: string; bytes: Uint8Array }): Promise<FileRow> {
  const id = nanoid(10);
  // some uploads name the file by its whole path; keep only the file name
  const name = input.name.split(/[\\/]/).pop() || input.name;
  const kind = fileKindOf(name) ?? null;
  db.insert(s.files).values({ id, projectId, name, relPath: input.relPath, kind, status: "reading" }).run();
  try {
    const parsed = await parseFile(name, input.bytes);
    const dir = path.join(filesDir(), projectId);
    fs.mkdirSync(dir, { recursive: true });
    const storedPath = path.join(dir, `${id}-${safeName(name)}`);
    fs.writeFileSync(storedPath, input.bytes);
    db.update(s.files)
      .set({ status: "done", storedPath, pageKind: parsed.pageKind, pageCount: parsed.pageCount, parsed: parsed.blocks, runningHeaders: parsed.runningHeaders, textQuality: parsed.textQuality ?? null })
      .where(eq(s.files.id, id))
      .run();
  } catch (e) {
    const error = e instanceof ImportError ? e.message : "Margin couldn't read this file. Try opening and re-saving it, then add it again.";
    db.update(s.files).set({ status: "failed", error }).where(eq(s.files.id, id)).run();
  }
  return db.select({ id: s.files.id, name: s.files.name, relPath: s.files.relPath, status: s.files.status, error: s.files.error, pageCount: s.files.pageCount, pageKind: s.files.pageKind }).from(s.files).where(eq(s.files.id, id)).get()!;
}

/** Positions sections 0..n in a unit by file order, then reading order within each file. */
function renumber(db: Db, unitId: string) {
  const rows = db
    .select({ id: s.sections.id, relPath: s.files.relPath, position: s.sections.position })
    .from(s.sections)
    .innerJoin(s.files, eq(s.files.id, s.sections.fileId))
    .where(eq(s.sections.unitId, unitId))
    .all()
    .sort((a, b) => natural.compare(a.relPath, b.relPath) || a.position - b.position);
  rows.forEach((r, i) => db.update(s.sections).set({ position: i }).where(eq(s.sections.id, r.id)).run());
}

/**
 * Detect units, cut every file into sections and index their passages. Deterministic: no AI.
 * Safe to run again: it replaces what an earlier run made.
 */
export function analyzeProject(db: Db, projectId: string) {
  db.transaction((tx) => {
    tx.delete(s.parts).where(eq(s.parts.projectId, projectId)).run(); // layers point at passages, so they go first
    tx.delete(s.units).where(eq(s.units.projectId, projectId)).run(); // cascades to sections and passages
    const done = tx.select().from(s.files).where(eq(s.files.projectId, projectId)).all().filter((f) => f.status === "done");

    const detected = detectUnits(done.map((f) => ({ id: f.id, relPath: f.relPath })));
    detected.forEach((u, position) => {
      const unitId = nanoid(10);
      tx.insert(s.units).values({ id: unitId, projectId, title: u.title, position, isOverview: u.isOverview }).run();
      const unitFiles = done.filter((f) => u.fileIds.includes(f.id)).sort((a, b) => natural.compare(a.relPath, b.relPath));
      let pos = 0;
      for (const f of unitFiles) {
        tx.update(s.files).set({ unitId }).where(eq(s.files.id, f.id)).run();
        const sections = splitSections({ kind: f.kind!, pageKind: f.pageKind!, pageCount: f.pageCount ?? 0, blocks: f.parsed ?? [], runningHeaders: f.runningHeaders ?? [] });
        for (const sec of sections) {
          const sectionId = nanoid(10);
          tx.insert(s.sections).values({ id: sectionId, projectId, unitId, fileId: f.id, position: pos++, title: sec.title, pageStart: sec.pageStart, pageEnd: sec.pageEnd, wordCount: sec.wordCount, original: sec.blocks }).run();
          for (const p of makePassages(sec)) tx.insert(s.passages).values({ id: nanoid(10), projectId, fileId: f.id, sectionId, page: p.page, ordinal: p.ordinal, text: p.text }).run();
        }
      }
    });

    const project = tx.select().from(s.projects).where(eq(s.projects.id, projectId)).get();
    if (project && !project.courseCode) {
      const code = detectCourseCode(done.map((f) => f.relPath));
      if (code) tx.update(s.projects).set({ courseCode: code }).where(eq(s.projects.id, projectId)).run();
    }
    tx.update(s.projects).set({ status: "reviewing" }).where(eq(s.projects.id, projectId)).run();
  });
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
function tidyUnits(db: Db, projectId: string) {
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
  });
}

/** The unit review is done. Next the Parts and layers are proposed and approved; only then is the project ready. */
export function finishReview(db: Db, projectId: string) {
  db.update(s.projects).set({ status: "building" }).where(and(eq(s.projects.id, projectId), eq(s.projects.status, "reviewing"))).run();
}

export function listProjects(db: Db) {
  return db
    .select({
      id: s.projects.id,
      name: s.projects.name,
      courseCode: s.projects.courseCode,
      status: s.projects.status,
      sections: sql<number>`(select count(*) from sections where sections.project_id = projects.id)`,
      units: sql<number>`(select count(*) from units where units.project_id = projects.id)`,
    })
    .from(s.projects)
    .orderBy(sql`${s.projects.createdAt} desc`)
    .all();
}
