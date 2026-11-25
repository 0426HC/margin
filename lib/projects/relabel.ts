/**
 * Changing a file's week or type after import, from the files list. Weeks and the Lecture / Reading label are read live everywhere
 * (layer week labels, the Lecture tab, the Weeks view), so those change at once. A change of kind moves the file's text where it now
 * belongs: into a layer (as required material), out of every layer (syllabus, exam material, my notes), or beside one (optional). A file
 * that stops being "My notes" takes its copy out of Lecture notes. The student's own writing is never touched: layers emptied of text keep
 * their write-ups, and anything the student wrote or changed on a Lecture notes page stays.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { ensureExams } from "@/lib/exam/service";
import { attachOptional, layerFitter, StructureError } from "@/lib/layers/service";
import { courseWeekCount } from "@/lib/weeks/count";
import { importNotesFile, moveImportedNotes, removeImportedNotes } from "./course-import";
import { stripCommonRoot } from "@/lib/import/paths";
import { indexFile, renumber, tidyUnits } from "./service";

import { placementOf, type CourseFileRow, type FileType } from "./file-kinds";
export type { CourseFileRow };

type Tx = Db;

/** Take every passage of a file out of the layers. A layer left empty with no work of the student's is removed; one with work stays, marked. */
function takeOutOfLayers(db: Tx, fileId: string) {
  const layerIds = db
    .select({ id: s.layerPassages.layerId })
    .from(s.layerPassages)
    .innerJoin(s.passages, eq(s.passages.id, s.layerPassages.passageId))
    .where(eq(s.passages.fileId, fileId))
    .groupBy(s.layerPassages.layerId)
    .all()
    .map((r) => r.id);
  const ids = db.select({ id: s.passages.id }).from(s.passages).where(eq(s.passages.fileId, fileId)).all().map((r) => r.id);
  if (ids.length) db.delete(s.layerPassages).where(inArray(s.layerPassages.passageId, ids)).run();
  for (const layerId of layerIds) {
    const left = db.select({ n: sql<number>`count(*)` }).from(s.layerPassages).where(eq(s.layerPassages.layerId, layerId)).get()!.n;
    const work = db.get<{ c: number }>(sql`select (select count(*) from writebacks where target_id = ${layerId}) + (select count(*) from layer_messages where target_id = ${layerId}) + (select count(*) from note_saves where target_id = ${layerId}) as c`)?.c ?? 0;
    if (!left && !work) db.delete(s.layers).where(eq(s.layers.id, layerId)).run();
    else db.update(s.layers).set({ newMaterialAt: Date.now() }).where(and(eq(s.layers.id, layerId), sql`${s.layers.contentStatus} != 'none'`)).run();
  }
  db.delete(s.layerOptional).where(eq(s.layerOptional.fileId, fileId)).run();
}

/** Remove a file's sections and passages (it is no longer course text). */
function unindex(db: Tx, file: typeof s.files.$inferSelect) {
  db.delete(s.sections).where(eq(s.sections.fileId, file.id)).run();
  db.update(s.files).set({ unitId: null }).where(eq(s.files.id, file.id)).run();
  if (file.unitId) renumber(db, file.unitId);
}

/** The unit a file's text goes into: its week's ("Week 3"), the syllabus's, or "Optional readings". Made if missing. */
function unitFor(db: Tx, projectId: string, kind: "course" | "syllabus" | "optional", week: number | null): string {
  const units = db.select().from(s.units).where(eq(s.units.projectId, projectId)).orderBy(asc(s.units.position)).all();
  const title = kind === "syllabus" ? "Course overview" : kind === "optional" ? "Optional readings" : week ? `Week ${week}` : "Misc";
  const found = kind === "syllabus" ? units.find((u) => u.isOverview) : units.find((u) => u.title === title || (kind === "course" && week !== null && new RegExp(`^Week ${week}(?!\\d)`).test(u.title)));
  if (found) return found.id;
  const id = nanoid(10);
  db.insert(s.units).values({ id, projectId, title, position: units.length, isOverview: kind === "syllabus" }).run();
  // keep the order: the syllabus first, weeks by number, Misc and optional readings last
  const rank = (u: { title: string; isOverview: boolean }) => (u.isOverview ? -1 : u.title === "Optional readings" ? 10_001 : u.title === "Misc" ? 10_000 : Number(/^Week (\d+)/.exec(u.title)?.[1] ?? 9_999));
  db.select().from(s.units).where(eq(s.units.projectId, projectId)).all().sort((a, b) => rank(a) - rank(b)).forEach((u, i) => db.update(s.units).set({ position: i }).where(eq(s.units.id, u.id)).run());
  return id;
}

/** Make sure a file's text is indexed in the right unit, moving its sections if they sit elsewhere. */
function indexIn(db: Tx, file: typeof s.files.$inferSelect, unitId: string) {
  const has = db.select({ n: sql<number>`count(*)` }).from(s.sections).where(eq(s.sections.fileId, file.id)).get()!.n;
  if (!has) {
    const pos = db.select({ n: sql<number>`coalesce(max(${s.sections.position}), -1) + 1` }).from(s.sections).where(eq(s.sections.unitId, unitId)).get()!.n;
    indexFile(db, file.projectId, unitId, file, pos);
  } else if (file.unitId !== unitId) {
    db.update(s.sections).set({ unitId }).where(eq(s.sections.fileId, file.id)).run();
    db.update(s.files).set({ unitId }).where(eq(s.files.id, file.id)).run();
    if (file.unitId) renumber(db, file.unitId);
  }
  renumber(db, unitId);
}

/** Put a file's passages into the layer its text fits best (as new material there). Before any layer exists, nothing to do. */
function placeInLayer(db: Tx, projectId: string, fileId: string, week: number | null) {
  const fitter = layerFitter(db, projectId);
  if (fitter.empty) return;
  const ps = db.select({ id: s.passages.id, text: s.passages.text }).from(s.passages).innerJoin(s.sections, eq(s.sections.id, s.passages.sectionId)).where(eq(s.passages.fileId, fileId)).orderBy(asc(s.sections.position), asc(s.passages.ordinal)).all();
  if (!ps.length) return;
  const best = fitter.rank(ps.map((p) => p.text).join(" "), week)[0];
  const start = db.select({ n: sql<number>`coalesce(max(${s.layerPassages.ordinal}), -1) + 1` }).from(s.layerPassages).where(eq(s.layerPassages.layerId, best.layerId)).get()!.n;
  ps.forEach((p, i) => db.insert(s.layerPassages).values({ layerId: best.layerId, passageId: p.id, ordinal: start + i }).onConflictDoNothing().run());
  db.update(s.layers).set({ newMaterialAt: Date.now() }).where(and(eq(s.layers.id, best.layerId), sql`${s.layers.contentStatus} != 'none'`)).run();
}

/** Change a file's week and/or type (or label a file that has none yet). The "check this" mark goes, and the reason says the student set it. */
export function relabelFile(db: Db, projectId: string, fileId: string, patch: { week?: number | null; type?: FileType }) {
  db.transaction((tx) => {
    const f = tx.select().from(s.files).where(and(eq(s.files.id, fileId), eq(s.files.projectId, projectId))).get();
    if (!f || f.status !== "done" || f.category === "duplicate") throw new StructureError("That file is no longer in this project. Reload the page.");
    const max = courseWeekCount(tx, projectId) ?? 60;
    if (patch.week !== undefined && patch.week !== null && (!Number.isInteger(patch.week) || patch.week < 1 || patch.week > Math.max(max, 60))) throw new StructureError(`Pick a week from 1 to ${max}.`);
    const week = patch.week === undefined ? f.week : patch.week;
    const type = patch.type ?? f.type;
    const before = f.category;
    if (!type) {
      // no type yet: keep the week until a type is chosen
      tx.update(s.files).set({ week }).where(eq(s.files.id, f.id)).run();
      return;
    }
    if (patch.week !== undefined && f.week !== null && week !== null && week !== f.week && before === "notes") moveImportedNotes(tx, projectId, f, f.week, week);
    const { category, role } = placementOf(type);
    tx.update(s.files).set({ week: category === "syllabus" ? null : week, type, category, role, needsCheck: false, reason: "You set this." }).where(eq(s.files.id, f.id)).run();
    const fresh = tx.select().from(s.files).where(eq(s.files.id, f.id)).get()!;
    if (before === "notes" && category !== "notes") removeImportedNotes(tx, projectId, f);

    if (category === "course") {
      indexIn(tx, fresh, unitFor(tx, projectId, "course", fresh.week));
      if (before !== "course") {
        tx.delete(s.layerOptional).where(eq(s.layerOptional.fileId, f.id)).run();
        placeInLayer(tx, projectId, f.id, fresh.week);
      }
    } else if (category === "optional") {
      if (before !== "optional") {
        takeOutOfLayers(tx, f.id);
        indexIn(tx, tx.select().from(s.files).where(eq(s.files.id, f.id)).get()!, unitFor(tx, projectId, "optional", fresh.week));
        attachOptional(tx, projectId);
      }
    } else if (category === "syllabus") {
      takeOutOfLayers(tx, f.id);
      indexIn(tx, tx.select().from(s.files).where(eq(s.files.id, f.id)).get()!, unitFor(tx, projectId, "syllabus", null));
    } else {
      // exam material and my notes are never course text
      takeOutOfLayers(tx, f.id);
      unindex(tx, tx.select().from(s.files).where(eq(s.files.id, f.id)).get()!);
      if (category === "notes" && fresh.week !== null && !tx.select().from(s.noteImports).where(eq(s.noteImports.fileId, f.id)).get()) importNotesFile(tx, projectId, fresh, fresh.week);
      if (category === "exam") ensureExams(tx, projectId);
    }
    tidyUnits(tx, projectId);
  });
}

/** Every read file of the course with its week and type, for the files list: in folder order. */
export function listCourseFiles(db: Db, projectId: string): CourseFileRow[] {
  const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  const rows = db
    .select()
    .from(s.files)
    .where(and(eq(s.files.projectId, projectId), eq(s.files.status, "done")))
    .all()
    .filter((f) => f.category !== "duplicate") // a second copy of a file is used once, under its first copy, and never listed twice
    .sort((a, b) => natural.compare(a.relPath, b.relPath));
  // the folder that was dropped is every file's first folder: it says nothing, so it is left out
  const paths = stripCommonRoot(rows.map((f) => f.relPath));
  return rows.map((f, i) => {
    const parts = paths[i].split("/");
    return { id: f.id, name: f.name, folder: parts.slice(0, -1).join(" / "), week: f.week, type: f.type, check: f.needsCheck, reason: f.reason };
  });
}
