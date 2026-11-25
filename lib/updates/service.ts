import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import fs from "node:fs";
import type { Engine } from "@/lib/ai/engine";
import { BadStructuredOutput } from "@/lib/ai/errors";
import { placeNewMaterial } from "@/lib/ai/tasks";
import type { Placement } from "@/lib/ai/schemas";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { measure, readCourse, syllabusText, type FileLabel, type MeasuredFile, type Progress } from "@/lib/import/organize";
import { ImportError, parseFile } from "@/lib/import/parse";
import type { FileRole } from "@/lib/import/types";
import { attachOptional, closeGaps, partRows, passageWeeks, rowLabel, weekRowFor } from "@/lib/layers/service";
import { courseWeekRows, importNotesFile, newNoteLines } from "@/lib/projects/course-import";
import type { FileType } from "@/lib/projects/file-kinds";
import { sameTitle } from "@/lib/layers/duplicates";
import { courseOrder } from "@/lib/layers/reading-order";
import { indexFile, renumber, sha256, tidyUnits } from "@/lib/projects/service";
import { effectiveRole, examKindOf, type ExamKind } from "./classify";
import { diffFolder, type PickedFileRef, type StoredFileRef } from "./diff";
import { weekOfUnit } from "./weeks";
import { courseWeekCount } from "@/lib/weeks/count";
import { pageRangeWeeks } from "@/lib/projects/page-ranges";
import { tidyBrain } from "@/lib/brain/store";

/** Something the student can fix: a plain message, shown as is. */
export class UpdateError extends Error {}

// ---------------------------------------------------------------- the weeks of a course

export interface WeekRow {
  week: number;
  /** The date the syllabus gives, as written, or null. */
  date: string | null;
  /** Files (not exam sheets) the course holds for this week. */
  files: number;
  lectures: number;
  /** No files yet: shown as waiting. */
  waiting: boolean;
}

const fileWeek = (f: { week: number | null }, unitTitle: string | null) => f.week ?? (unitTitle ? weekOfUnit(unitTitle) : null);

/** Every week of the course, from 1 to its number of weeks, with its date (as Claude read it from the syllabus), its files and whether it still waits for any. */
export function getCourseWeeks(db: Db, projectId: string): { count: number; weeks: WeekRow[] } {
  const units = db.select().from(s.units).where(eq(s.units.projectId, projectId)).all();
  const count = courseWeekCount(db, projectId) ?? 0;
  const titleOf = new Map(units.map((u) => [u.id, u.title]));
  const rows = db
    .select({ id: s.files.id, week: s.files.week, unitId: s.files.unitId, role: s.files.role, category: s.files.category })
    .from(s.files)
    .where(and(eq(s.files.projectId, projectId), eq(s.files.status, "done")))
    .all();
  const per = new Map<number, { files: number; lectures: number }>();
  const split = pageRangeWeeks(db, projectId);
  for (const f of rows) {
    if (!f.unitId || f.category !== "course") continue;
    // a file whose pages the syllabus splits between weeks counts in each of those weeks
    const own = fileWeek(f, titleOf.get(f.unitId) ?? null);
    for (const w of new Set([...(own ? [own] : []), ...(split.get(f.id) ?? [])])) {
      const e = per.get(w) ?? { files: 0, lectures: 0 };
      e.files++;
      if (f.role === "lecture") e.lectures++;
      per.set(w, e);
    }
  }
  const dates = new Map(courseWeekRows(db, projectId).map((w) => [w.week, w.date]));
  return {
    count,
    weeks: Array.from({ length: count }, (_, i) => {
      const e = per.get(i + 1) ?? { files: 0, lectures: 0 };
      return { week: i + 1, date: dates.get(i + 1) ?? null, files: e.files, lectures: e.lectures, waiting: e.files === 0 };
    }),
  };
}

// ---------------------------------------------------------------- comparing a folder

export interface WhatsNewFile {
  name: string;
  relPath: string;
  hash: string;
}
export interface ComparedFolder {
  added: WhatsNewFile[];
  changed: (WhatsNewFile & { storedId: string; storedName: string; week: number | null; role: FileRole; type: FileType | null })[];
  removed: { id: string; name: string; relPath: string; week: number | null; role: FileRole; passages: number; layers: number }[];
  unchanged: number;
}

/** A stored file's fingerprint. Files imported before hashes were kept are hashed from their stored copy, once, and remembered. */
function storedHash(db: Db, f: { id: string; contentHash: string | null; storedPath: string | null }): string | null {
  if (f.contentHash) return f.contentHash;
  if (!f.storedPath || !fs.existsSync(f.storedPath)) return null;
  const h = sha256(fs.readFileSync(f.storedPath));
  db.update(s.files).set({ contentHash: h }).where(eq(s.files.id, f.id)).run();
  return h;
}

/** New, changed, removed and unchanged files, by path and content hash. Reads the database; writes nothing the student would notice and calls no AI. */
export function compareFolder(db: Db, projectId: string, picked: (PickedFileRef & { name: string })[]): ComparedFolder {
  const rows = db.select().from(s.files).where(eq(s.files.projectId, projectId)).all();
  const unitTitle = new Map(
    db
      .select({ id: s.units.id, title: s.units.title })
      .from(s.units)
      .where(eq(s.units.projectId, projectId))
      .all()
      .map((u) => [u.id, u.title]),
  );
  const stored: StoredFileRef[] = rows.map((f) => ({ id: f.id, relPath: f.relPath, hash: storedHash(db, f), absent: f.absent }));
  const d = diffFolder(stored, picked);
  const byId = new Map(rows.map((f) => [f.id, f]));
  const nameOf = new Map(picked.map((p) => [p.relPath, p.name]));
  const layersOf = (fileId: string) =>
    db
      .select({ n: sql<number>`count(distinct ${s.layerPassages.layerId})`, p: sql<number>`count(*)` })
      .from(s.layerPassages)
      .innerJoin(s.passages, eq(s.passages.id, s.layerPassages.passageId))
      .where(eq(s.passages.fileId, fileId))
      .get()!;
  return {
    added: d.added.map((p) => ({ name: nameOf.get(p.relPath) ?? p.relPath, relPath: p.relPath, hash: p.hash })),
    changed: d.changed.map((c) => {
      const f = byId.get(c.storedId)!;
      return {
        name: nameOf.get(c.picked.relPath) ?? f.name,
        relPath: c.picked.relPath,
        hash: c.picked.hash,
        storedId: f.id,
        storedName: f.name,
        week: fileWeek(f, f.unitId ? (unitTitle.get(f.unitId) ?? null) : null),
        role: effectiveRole(f),
        type: f.type,
      };
    }),
    removed: d.removed.map((r) => {
      const f = byId.get(r.id)!;
      const n = layersOf(f.id);
      return {
        id: f.id,
        name: f.name,
        relPath: f.relPath,
        week: fileWeek(f, f.unitId ? (unitTitle.get(f.unitId) ?? null) : null),
        role: effectiveRole(f),
        passages: n.p,
        layers: n.n,
      };
    }),
    unchanged: d.unchanged,
  };
}

// ---------------------------------------------------------------- looking at the new files before anything is written

export type Inspected = { ok: true; name: string; kind: string; pageKind: string; pageCount: number; words: number; facts: MeasuredFile } | { ok: false; name: string; error: string };

/** Read a file in memory and measure it for Claude (its size over the whole file, headings, opening words). Nothing is stored or decided. */
export async function inspectFile(input: { name: string; relPath: string; bytes: Uint8Array }): Promise<Inspected> {
  const name = input.name.split(/[\\/]/).pop() || input.name;
  try {
    const parsed = await parseFile(name, input.bytes);
    const facts = measure({ kind: parsed.kind, pageKind: parsed.pageKind, pageCount: parsed.pageCount, blocks: parsed.blocks, author: parsed.author });
    return { ok: true, name, kind: parsed.kind, pageKind: parsed.pageKind, pageCount: parsed.pageCount, words: facts.words, facts };
  } catch (e) {
    return { ok: false, name, error: e instanceof ImportError ? e.message : "Margin couldn't read this file. Try opening and re-saving it, then add it again." };
  }
}

export type Labelled = { ok: true; labels: Record<string, FileLabel> } | { ok: false; message: string };

/**
 * What the new files are: Claude reads the course's syllabus (as stored), its weeks, the files it already holds and the folder tree, and
 * labels each new file (week, type, how sure, why), exactly as at import. Keys are the new files' paths. Nothing is stored.
 */
export async function labelNewFiles(db: Db, engine: Engine, projectId: string, files: { relPath: string; facts: MeasuredFile }[], onProgress?: Progress, signal?: AbortSignal): Promise<Labelled> {
  const project = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get();
  if (!project) throw new UpdateError("That project no longer exists.");
  const stored = db.select().from(s.files).where(and(eq(s.files.projectId, projectId), eq(s.files.status, "done"))).all();
  const known = stored.filter((f) => f.category !== "duplicate");
  const syllabus = known.filter((f) => f.category === "syllabus").map((f) => ({ path: f.relPath, text: syllabusText(f.parsed ?? []) }));
  const rows = courseWeekRows(db, projectId);
  const count = courseWeekCount(db, projectId) ?? 0;
  const weeks = rows.length ? rows.map((w) => ({ week: w.week, date: w.date, title: w.title, kind: w.kind })) : Array.from({ length: count }, (_, i) => ({ week: i + 1, date: null, title: "", kind: "class" }));
  for (let w = weeks.length + 1; w <= count; w++) weeks.push({ week: w, date: null, title: "", kind: "class" }); // the student may have made the course longer
  const result = await readCourse(
    engine,
    {
      course: [project.courseCode, project.name].filter(Boolean).join(" · "),
      allPaths: known.map((f) => f.relPath),
      files: files.map((f) => ({ key: f.relPath, relPath: f.relPath, facts: f.facts })),
      known: { syllabus, weeks, files: known.map((f) => ({ path: f.relPath, type: f.type ?? "not labelled", week: f.week })) },
    },
    onProgress,
    signal,
  );
  return result.ok ? { ok: true, labels: Object.fromEntries(result.labels) } : { ok: false, message: result.message };
}

// ---------------------------------------------------------------- writing it into the course

/** Unit order, like the first import: the overview first, then by the number in the title, then what was already there. */
function sortUnits(db: Db, projectId: string) {
  const num = (t: string) => (/^[A-Za-z]+\s+(\d+)/.exec(t)?.[1] ? Number(/^[A-Za-z]+\s+(\d+)/.exec(t)![1]) : Infinity);
  const units = db.select().from(s.units).where(eq(s.units.projectId, projectId)).all();
  units
    .sort((a, b) => Number(b.isOverview) - Number(a.isOverview) || num(a.title) - num(b.title) || a.position - b.position)
    .forEach((u, i) => db.update(s.units).set({ position: i }).where(eq(s.units.id, u.id)).run());
}

/** The unit for a week, made if the course has none yet ("Week 5"). With no week, the "Misc" unit, as the first import does. */
function ensureUnit(db: Db, projectId: string, week: number | null): string {
  const units = db.select().from(s.units).where(eq(s.units.projectId, projectId)).all();
  const found = week === null ? units.find((u) => u.title === "Misc") : units.find((u) => !u.isOverview && weekOfUnit(u.title) === week);
  if (found) return found.id;
  const id = nanoid(10);
  db.insert(s.units)
    .values({ id, projectId, title: week === null ? "Misc" : `Week ${week}`, position: units.length, isOverview: false })
    .run();
  sortUnits(db, projectId);
  return id;
}

/** A unit by name ("Optional readings", "Course overview"), made if missing, kept in course order. */
function ensureNamedUnit(db: Db, projectId: string, title: string, isOverview: boolean): string {
  const found = db.select().from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.title, title))).get();
  if (found) return found.id;
  const id = nanoid(10);
  const n = db.select({ n: sql<number>`count(*)` }).from(s.units).where(eq(s.units.projectId, projectId)).get()!.n;
  db.insert(s.units).values({ id, projectId, title, position: isOverview ? -1 : n + 100, isOverview }).run();
  sortUnits(db, projectId);
  return id;
}

/** Order a layer's passages by where they sit in the course, after passages were added to it. */
function resortLayer(db: Db, layerId: string) {
  db.all<{ passageId: string }>(
    sql`
    select lp.passage_id as passageId from layer_passages lp
    join passages p on p.id = lp.passage_id join sections sc on sc.id = p.section_id join units u on u.id = sc.unit_id
    where lp.layer_id = ${layerId} order by u.position, sc.position, p.ordinal`,
  ).forEach((r, i) => db.update(s.layerPassages).set({ ordinal: i }).where(eq(s.layerPassages.passageId, r.passageId)).run());
}

const markNewMaterial = (db: Db, layerId: string) =>
  db
    .update(s.layers)
    .set({ newMaterialAt: Date.now() })
    .where(and(eq(s.layers.id, layerId), sql`${s.layers.contentStatus} != 'none'`))
    .run();

/** How many of `total` new passages each old layer gets, in proportion to what it held, every one getting at least one when there are enough. */
export function shareOut(total: number, held: number[]): number[] {
  const sum = held.reduce((a, b) => a + b, 0) || 1;
  const exact = held.map((h) => (total * h) / sum);
  const out = exact.map((x) => Math.floor(x));
  if (total >= held.length) out.forEach((v, i) => v === 0 && (out[i] = 1));
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0 && order.length; k++, left--) out[order[k % order.length][1]]++;
  for (let i = out.length - 1; left < 0 && i >= 0;) {
    if (out[i] > 1) {
      out[i]--;
      left++;
    } else i--;
  }
  return out;
}

function hasStudentWork(db: Db, layerId: string): boolean {
  const n = db.get<{ c: number }>(
    sql`select (select count(*) from writebacks where target_id = ${layerId}) + (select count(*) from layer_messages where target_id = ${layerId}) + (select count(*) from note_saves where target_id = ${layerId}) + (select count(*) from quick_notes where target_id = ${layerId}) as c`,
  );
  return (n?.c ?? 0) > 0;
}

/**
 * Layers that just lost passages (a file left, or pages moved to another week): one with passages left shows "New material since you
 * saved"; an empty one stays if the student worked in it, otherwise it goes. Returns the weeks touched and what was emptied or deleted.
 */
export function afterPassagesLeft(db: Db, layerIds: string[]): { parts: Set<string>; emptied: string[]; deleted: string[] } {
  const out = { parts: new Set<string>(), emptied: [] as string[], deleted: [] as string[] };
  for (const layerId of layerIds) {
    const layer = db.select().from(s.layers).where(eq(s.layers.id, layerId)).get();
    if (!layer) continue;
    const left = db.select({ n: sql<number>`count(*)` }).from(s.layerPassages).where(eq(s.layerPassages.layerId, layerId)).get()!.n;
    out.parts.add(layer.partId);
    if (left > 0) {
      markNewMaterial(db, layerId);
      resortLayer(db, layerId);
    } else if (hasStudentWork(db, layerId)) {
      out.emptied.push(layerId);
      markNewMaterial(db, layerId);
    } else {
      db.delete(s.layers).where(eq(s.layers.id, layerId)).run();
      out.deleted.push(layerId);
    }
  }
  return out;
}

export interface CommitInput {
  /** Files already stored by `stageFile`, in the order to add them. `replaces` is the stored file a changed file takes the place of. */
  staged: { fileId: string; replaces?: string }[];
  /** Files that left the folder. `keep` keeps their passages in the course; otherwise they are removed from it. */
  removals: { fileId: string; keep: boolean }[];
}
export interface CommitResult {
  added: string[];
  replaced: string[];
  examSheets: { id: string; name: string; kind: ExamKind }[];
  removed: number;
  kept: number;
  /** Layers that no longer hold any passage but have the student's work, so they stay. */
  emptiedLayers: string[];
  deletedLayers: string[];
}

/** Write the approved files into the course. Saved write-ups, Note to Self and chats are never touched. Sync and all-or-nothing; the AI placement comes after. */
export function commitFiles(db: Db, projectId: string, input: CommitInput): CommitResult {
  const result: CommitResult = { added: [], replaced: [], examSheets: [], removed: 0, kept: 0, emptiedLayers: [], deletedLayers: [] };
  const toDeleteOnDisk: string[] = [];
  db.transaction((tx) => {
    const touchedParts = new Set<string>();
    const dropFile = (fileId: string) => {
      const f = tx.select().from(s.files).where(eq(s.files.id, fileId)).get();
      if (!f || f.projectId !== projectId) return null;
      const layerIds = tx
        .select({ id: s.layerPassages.layerId })
        .from(s.layerPassages)
        .innerJoin(s.passages, eq(s.passages.id, s.layerPassages.passageId))
        .where(eq(s.passages.fileId, fileId))
        .groupBy(s.layerPassages.layerId)
        .all()
        .map((r) => r.id);
      tx.delete(s.files).where(eq(s.files.id, fileId)).run(); // sections and passages go with it, and so do the passages' places in layers
      if (f.storedPath) toDeleteOnDisk.push(f.storedPath);
      return { file: f, layerIds };
    };
    const afterDrop = (layerIds: string[]) => {
      const r = afterPassagesLeft(tx, layerIds);
      r.parts.forEach((p) => touchedParts.add(p));
      result.emptiedLayers.push(...r.emptied);
      result.deletedLayers.push(...r.deleted);
    };

    for (const r of input.removals) {
      if (!r.keep) {
        const dropped = dropFile(r.fileId);
        if (dropped) {
          afterDrop(dropped.layerIds);
          result.removed++;
        }
      } else {
        tx.update(s.files)
          .set({ absent: true })
          .where(and(eq(s.files.id, r.fileId), eq(s.files.projectId, projectId)))
          .run();
        result.kept++;
      }
    }

    for (const st of input.staged) {
      const f = tx.select().from(s.files).where(eq(s.files.id, st.fileId)).get();
      if (!f || f.projectId !== projectId || f.status !== "done") continue;
      const role = f.role;
      let unitId: string | null = null;
      const shares: { layerId: string; count: number }[] = [];
      let oldUnit: string | null = null;
      let oldWeek: number | null = null;
      if (st.replaces) {
        const old = tx.select().from(s.files).where(eq(s.files.id, st.replaces)).get();
        if (old && old.projectId === projectId) {
          oldUnit = old.unitId;
          oldWeek = old.week;
          const rows = tx
            .select({ layerId: s.layerPassages.layerId })
            .from(s.layerPassages)
            .innerJoin(s.passages, eq(s.passages.id, s.layerPassages.passageId))
            .innerJoin(s.sections, eq(s.sections.id, s.passages.sectionId))
            .where(eq(s.passages.fileId, old.id))
            .orderBy(asc(s.sections.position), asc(s.passages.ordinal))
            .all();
          for (const r of rows) {
            const found = shares.find((x) => x.layerId === r.layerId);
            if (found) found.count++;
            else shares.push({ layerId: r.layerId, count: 1 });
          }
          dropFile(old.id);
          result.replaced.push(f.id);
        }
      }
      if (!f.category) {
        // no type yet: it waits in the files list until the student labels it
        result.added.push(f.id);
        continue;
      }
      if (f.category === "exam") {
        tx.update(s.files).set({ unitId: null }).where(eq(s.files.id, f.id)).run();
        result.examSheets.push({ id: f.id, name: f.name, kind: examKindOf(f.name, (f.parsed ?? []).map((b) => b.text).join("\n")) });
        continue;
      }
      if (f.category === "notes") {
        // my notes go into that week's Lecture notes: a changed notes file adds only its new lines, below, and never overwrites what is there
        const week = f.week ?? oldWeek;
        if (week === null) {
          // no clear week: it waits, marked, until the student picks one in the files list
          tx.update(s.files).set({ unitId: null, needsCheck: true }).where(eq(s.files.id, f.id)).run();
          result.added.push(f.id);
          continue;
        }
        tx.update(s.files).set({ role: null, unitId: null, week }).where(eq(s.files.id, f.id)).run();
        const before = st.replaces ? tx.select().from(s.noteImports).where(eq(s.noteImports.relPath, f.relPath)).all().filter((n) => n.projectId === projectId) : [];
        if (before.length) {
          const fresh = newNoteLines(before.map((n) => n.text).join("\n"), f.parsed ?? []);
          if (fresh.length) {
            const page = tx.select().from(s.weekNotes).where(and(eq(s.weekNotes.projectId, projectId), eq(s.weekNotes.week, week))).get();
            const blocks = [...(page?.blocks ?? []), { type: "heading" as const, text: `New in ${f.name}` }, ...fresh];
            const now = Date.now();
            tx.insert(s.weekNotes).values({ projectId, week, blocks, updatedAt: now }).onConflictDoUpdate({ target: [s.weekNotes.projectId, s.weekNotes.week], set: { blocks, updatedAt: now } }).run();
            tx.insert(s.noteImports).values({ id: nanoid(10), projectId, fileId: f.id, relPath: f.relPath, week, hash: f.contentHash ?? "", text: fresh.map((b) => b.text).join("\n") }).run();
          }
        } else importNotesFile(tx, projectId, f, week);
        result.added.push(f.id);
        continue;
      }
      const week = f.week ?? oldWeek;
      const special = f.category === "syllabus" ? tx.select().from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.isOverview, true))).get()?.id ?? ensureNamedUnit(tx, projectId, "Course overview", true) : f.category === "optional" ? ensureNamedUnit(tx, projectId, "Optional readings", false) : null;
      unitId =
        special ??
        (f.week === null && oldUnit && tx.select({ id: s.units.id }).from(s.units).where(eq(s.units.id, oldUnit)).get()
          ? oldUnit
          : ensureUnit(tx, projectId, week));
      const pos = tx
        .select({ n: sql<number>`coalesce(max(${s.sections.position}), -1) + 1` })
        .from(s.sections)
        .where(eq(s.sections.unitId, unitId))
        .get()!.n;
      indexFile(tx, projectId, unitId, f, pos);
      renumber(tx, unitId);
      tx.update(s.files)
        .set({ role, week: f.category === "syllabus" ? null : (f.week ?? oldWeek) })
        .where(eq(s.files.id, f.id))
        .run();
      result.added.push(f.id);
      if (f.category === "syllabus" || f.category === "optional") continue; // read for structure, or set beside a layer: never shared into layers

      if (shares.length) {
        const fresh = tx
          .select({ id: s.passages.id })
          .from(s.passages)
          .innerJoin(s.sections, eq(s.sections.id, s.passages.sectionId))
          .where(eq(s.passages.fileId, f.id))
          .orderBy(asc(s.sections.position), asc(s.passages.ordinal))
          .all();
        const counts = shareOut(
          fresh.length,
          shares.map((x) => x.count),
        );
        let at = 0;
        shares.forEach((sh, i) => {
          for (let k = 0; k < counts[i] && at < fresh.length; k++)
            tx.insert(s.layerPassages)
              .values({ layerId: sh.layerId, passageId: fresh[at++].id, ordinal: 1_000_000 + at })
              .run();
          markNewMaterial(tx, sh.layerId);
          resortLayer(tx, sh.layerId);
        });
        const partIds = tx
          .select({ id: s.layers.partId })
          .from(s.layers)
          .where(
            inArray(
              s.layers.id,
              shares.map((x) => x.layerId),
            ),
          )
          .all();
        for (const p of partIds) touchedParts.add(p.id);
      }
    }
    for (const partId of touchedParts) closeGaps(tx, partId);
    tidyUnits(tx, projectId);
    attachOptional(tx, projectId);
    tidyBrain(tx, projectId); // removed files took their places in the brain with them; new files are read in the background
  });
  for (const p of toDeleteOnDisk) fs.rmSync(p, { force: true });
  return result;
}

// ---------------------------------------------------------------- placing new passages

export interface Pending {
  /** Passages that belong to no layer yet (placing them failed, or has not run). */
  unplaced: number;
  /** New layers waiting for the student's approval. */
  proposed: ProposedLayer[];
  /** The course's approved layers, so a proposed layer can be merged into one. */
  layers: { id: string; title: string; week: string }[];
}
export interface ProposedLayer {
  id: string;
  title: string;
  bigQuestion: string;
  buildsOn: string;
  /** "Week 3 · Congress": the week it would join. */
  week: string;
  /** The week's number, when it has one. */
  weekNumber: number | null;
  /** Made from a lecture file only: "Your Week 3 lecture covers something new". */
  fromLecture: boolean;
  passages: number;
  files: string[];
}
export interface PlaceResult {
  /** Existing layers that took new passages, with the files that went in. */
  toLayers: { layerId: string; title: string; week: string; files: string[]; passages: number }[];
  proposed: ProposedLayer[];
  fellBack: boolean;
}

type LayerInfo = { id: string; n: number; title: string; bigQuestion: string; partId: string; week: string; hasContent: boolean };

function approvedLayers(db: Db, projectId: string): LayerInfo[] {
  const parts = db.select().from(s.parts).where(eq(s.parts.projectId, projectId)).orderBy(asc(s.parts.position), asc(s.parts.key)).all();
  const out: LayerInfo[] = [];
  for (const part of parts)
    for (const l of db
      .select()
      .from(s.layers)
      .where(and(eq(s.layers.partId, part.id), eq(s.layers.proposed, false)))
      .orderBy(asc(s.layers.position))
      .all())
      out.push({
        id: l.id,
        n: out.length + 1,
        title: l.title,
        bigQuestion: l.bigQuestion,
        partId: part.id,
        week: rowLabel(part),
        hasContent: l.contentStatus !== "none",
      });
  return out;
}

/** Check a placement against the numbered new passages: every one in exactly one group, and sensible layer numbers. Reasons, or an empty list. */
export function validatePlacement(p: Placement, passageCount: number, layerCount: number, layerTitles: string[] = []): string[] {
  const errors: string[] = [];
  // a new layer must be a new topic: not one the course already has, and not one another new group already is
  p.placements.forEach((g, gi) => {
    if (g.layer !== 0) return;
    const twin = layerTitles.findIndex((t) => sameTitle(t, g.title));
    if (twin >= 0) errors.push(`Group ${gi + 1} is a new layer, but "${g.title}" is the same topic as layer ${twin + 1} ("${layerTitles[twin]}"). Put its passages in layer ${twin + 1} instead.`);
    const earlier = p.placements.findIndex((h, hi) => hi < gi && h.layer === 0 && sameTitle(h.title, g.title));
    if (earlier >= 0) errors.push(`Groups ${earlier + 1} and ${gi + 1} are both new layers about the same topic. Make them one group.`);
  });
  const owner = new Array<number>(passageCount + 1).fill(0);
  p.placements.forEach((g, gi) => {
    if (g.layer > layerCount) errors.push(`Group ${gi + 1} names layer ${g.layer}, but only layers 1 to ${layerCount} exist. Use 0 for a new layer.`);
    if (g.layer === 0 && (g.title.trim().length < 2 || !g.bigQuestion.trim().endsWith("?")))
      errors.push(`Group ${gi + 1} is a new layer, so it needs a title and a big question ending in "?".`);
    for (const r of g.ranges) {
      if (r.to > passageCount) errors.push(`Group ${gi + 1} uses passages up to ${r.to}, but only 1 to ${passageCount} exist.`);
      for (let n = r.from; n <= Math.min(r.to, passageCount); n++) {
        if (owner[n]) errors.push(`Passage ${n} is in more than one group.`);
        owner[n] = gi + 1;
      }
    }
  });
  const missing: number[] = [];
  for (let n = 1; n <= passageCount; n++) if (!owner[n]) missing.push(n);
  if (missing.length) errors.push(`Passages ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? ", …" : ""} are not in any group.`);
  return [...new Set(errors)];
}

interface NewPassage {
  passageId: string;
  n: number;
  file: string;
  fileId: string;
  role: FileRole;
  week: number | null;
  page: number;
  text: string;
  unitPos: number;
  unitId: string;
}

/** Without the AI: a passage joins the layer that already holds the most of its unit; a unit no layer touches gets one new layer per file. */
export function fallbackPlacement(passages: { n: number; unitId: string; file: string }[], layerOfUnit: Map<string, number>): Placement {
  const placements: Placement["placements"] = [];
  for (const p of passages) {
    const layer = layerOfUnit.get(p.unitId) ?? 0;
    const last = placements[placements.length - 1];
    const stem = p.file.replace(/\.[a-z0-9]{1,5}$/i, "").slice(0, 70);
    const title = stem.length >= 2 ? stem : `New material (${stem || p.file})`;
    if (last && last.layer === layer && last.ranges[last.ranges.length - 1].to === p.n - 1 && (layer !== 0 || last.title === title))
      last.ranges[last.ranges.length - 1].to = p.n;
    else
      placements.push({
        layer,
        title: layer ? "" : title,
        bigQuestion: layer ? "" : `What does ${title} add to the course?`,
        buildsOn: layer ? "" : "Builds on the layers before it.",
        ranges: [{ from: p.n, to: p.n }],
      });
  }
  return { placements };
}

const weeksLabel = (ws: number[]) => (!ws.length ? "no week" : ws.length === 1 ? `Week ${ws[0]}` : `Weeks ${Math.min(...ws)}–${Math.max(...ws)}`);

/**
 * Put every passage that belongs to no layer into one: an existing layer (which then shows "New material since you saved"), or a new
 * layer that is only *proposed* until the student approves it. The AI proposes, code checks that every passage lands exactly once;
 * an invalid answer is retried once with the reasons, then a plain placement by unit is used. With `approveNew` (pages the syllabus moved to
 * another week, not new files) a new layer joins its week at once instead of waiting for approval.
 */
export async function placeNewPassages(db: Db, engine: Engine, projectId: string, signal?: AbortSignal, opts: { approveNew?: boolean } = {}): Promise<PlaceResult> {
  const layers = approvedLayers(db, projectId);
  const all = courseOrder(db, projectId); // only the course's own material is placed in layers
  const placed = new Set(
    db
      .select({ id: s.layerPassages.passageId })
      .from(s.layerPassages)
      .innerJoin(s.layers, eq(s.layers.id, s.layerPassages.layerId))
      .innerJoin(s.parts, eq(s.parts.id, s.layers.partId))
      .where(eq(s.parts.projectId, projectId))
      .all()
      .map((r) => r.id),
  );
  const loose = all.filter((p) => !placed.has(p.passageId));
  const result: PlaceResult = { toLayers: [], proposed: [], fellBack: false };
  if (!loose.length || !layers.length) return result;

  const meta = db
    .select({
      id: s.passages.id,
      fileId: s.files.id,
      week: s.files.week,
      role: s.files.role,
      name: s.files.name,
      kind: s.files.kind,
      pageKind: s.files.pageKind,
      relPath: s.files.relPath,
      unitPos: s.units.position,
      page: s.passages.page,
    })
    .from(s.passages)
    .innerJoin(s.files, eq(s.files.id, s.passages.fileId))
    .innerJoin(s.units, eq(s.units.id, s.files.unitId))
    .where(
      inArray(
        s.passages.id,
        loose.map((p) => p.passageId),
      ),
    )
    .all();
  const byId = new Map(meta.map((m) => [m.id, m]));
  const weekOf = passageWeeks(db, projectId);
  const fresh: NewPassage[] = loose.map((p, i) => {
    const m = byId.get(p.passageId)!;
    return {
      passageId: p.passageId,
      n: i + 1,
      file: p.file,
      fileId: m.fileId,
      role: effectiveRole(m),
      week: weekOf.get(p.passageId) ?? null,
      page: m.page,
      text: p.text,
      unitPos: m.unitPos,
      unitId: p.unitId,
    };
  });

  // what each existing layer already covers: its weeks (for the prompt) and which layer holds most of each unit (for the fallback)
  const unitOf = new Map(all.map((p) => [p.passageId, p]));
  const held = db
    .select({ layerId: s.layerPassages.layerId, passageId: s.layerPassages.passageId })
    .from(s.layerPassages)
    .where(
      inArray(
        s.layerPassages.layerId,
        layers.map((l) => l.id),
      ),
    )
    .all();
  const weeksOfLayer = new Map<string, Set<number>>();
  const unitCount = new Map<string, Map<string, number>>();
  for (const h of held) {
    const p = unitOf.get(h.passageId);
    if (!p) continue;
    const w = weekOf.get(h.passageId);
    if (w) weeksOfLayer.set(h.layerId, (weeksOfLayer.get(h.layerId) ?? new Set()).add(w));
    const c = unitCount.get(p.unitId) ?? new Map();
    c.set(h.layerId, (c.get(h.layerId) ?? 0) + 1);
    unitCount.set(p.unitId, c);
  }
  const layerOfUnit = new Map<string, number>();
  for (const [unitId, c] of unitCount) {
    const top = [...c].sort((a, b) => b[1] - a[1])[0];
    layerOfUnit.set(unitId, layers.find((l) => l.id === top[0])!.n);
  }

  const clip = fresh.length > 300 ? 110 : 200;
  const input = {
    layers: layers.map((l) => ({
      n: l.n,
      part: l.week,
      weeks: weeksLabel([...(weeksOfLayer.get(l.id) ?? [])]),
      title: l.title,
      bigQuestion: l.bigQuestion,
    })),
    passages: fresh.map((p) => ({
      n: p.n,
      file: p.file,
      role: p.role === "lecture" ? "lecture material" : "reading",
      week: p.week,
      page: p.page,
      text: p.text.replace(/\s+/g, " ").slice(0, clip),
    })),
  };
  let plan: Placement | null = null;
  let feedback: string | undefined;
  for (let attempt = 0; attempt < 2 && !plan; attempt++) {
    try {
      const proposal = await placeNewMaterial(engine, { ...input, feedback }, signal);
      const errors = validatePlacement(proposal, fresh.length, layers.length, layers.map((l) => l.title));
      if (!errors.length) plan = proposal;
      else feedback = errors.slice(0, 6).join(" ");
    } catch (e) {
      if (!(e instanceof BadStructuredOutput)) throw e; // a missing or logged-out claude is not an invalid answer
      feedback = "It did not match the required JSON shape.";
    }
  }
  if (!plan) {
    plan = fallbackPlacement(fresh, layerOfUnit);
    result.fellBack = true;
  }

  const nearestPart = (unitPos: number): string => {
    const positions = new Map(
      db
        .select({ id: s.units.id, pos: s.units.position })
        .from(s.units)
        .where(eq(s.units.projectId, projectId))
        .all()
        .map((u) => [u.id, u.pos]),
    );
    let best = layers[0];
    let bestD = Infinity;
    for (const l of layers)
      for (const h of held.filter((x) => x.layerId === l.id)) {
        const d = Math.abs((positions.get(unitOf.get(h.passageId)?.unitId ?? "") ?? 1e9) - unitPos);
        if (d < bestD) {
          bestD = d;
          best = l;
        }
      }
    return best.partId;
  };

  // a new layer goes to the week its passages come from (most of them), made for it if the week has no layers yet; passages with no week
  // go to the week of the layer nearest them in the course
  const weekRowOf = (tx: Db, weeks: number[], unitPos: number): string => {
    if (!weeks.length) return nearestPart(unitPos);
    const tally = new Map<number, number>();
    for (const w of weeks) tally.set(w, (tally.get(w) ?? 0) + 1);
    const week = [...tally].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0][0];
    return weekRowFor(tx, projectId, week, opts.approveNew ? "approved" : "proposed");
  };

  db.transaction((tx) => {
    let newIndex = 0;
    for (const g of plan!.placements) {
      const ids = g.ranges.flatMap((r) => Array.from({ length: Math.max(0, Math.min(r.to, fresh.length) - r.from + 1) }, (_, i) => fresh[r.from - 1 + i]));
      if (!ids.length) continue;
      const files = [...new Set(ids.map((p) => p.file))];
      if (g.layer > 0) {
        const layer = layers[g.layer - 1];
        let ord = 1_000_000;
        for (const p of ids) tx.insert(s.layerPassages).values({ layerId: layer.id, passageId: p.passageId, ordinal: ord++ }).run();
        resortLayer(tx, layer.id);
        markNewMaterial(tx, layer.id);
        const e = result.toLayers.find((x) => x.layerId === layer.id);
        if (e) {
          e.files = [...new Set([...e.files, ...files])];
          e.passages += ids.length;
        } else result.toLayers.push({ layerId: layer.id, title: layer.title, week: layer.week, files, passages: ids.length });
      } else {
        const partId = weekRowOf(tx, ids.map((p) => p.week).filter((w): w is number => w !== null), Math.min(...ids.map((p) => p.unitPos)));
        const part = tx.select().from(s.parts).where(eq(s.parts.id, partId)).get()!;
        const id = nanoid(10);
        tx.insert(s.layers)
          .values({
            id,
            partId,
            position: 10_000 + newIndex++,
            title: g.title.trim().slice(0, 80),
            bigQuestion: g.bigQuestion.trim(),
            buildsOn: g.buildsOn.trim(),
            proposed: !opts.approveNew,
          })
          .run();
        ids.forEach((p, i) => tx.insert(s.layerPassages).values({ layerId: id, passageId: p.passageId, ordinal: i }).run());
        if (opts.approveNew) {
          closeGaps(tx, partId);
          continue;
        }
        result.proposed.push({
          id,
          title: g.title.trim().slice(0, 80),
          bigQuestion: g.bigQuestion.trim(),
          buildsOn: g.buildsOn.trim(),
          week: rowLabel(part),
          weekNumber: part.week,
          fromLecture: ids.every((p) => p.role === "lecture"),
          passages: ids.length,
          files,
        });
      }
    }
  });
  return result;
}

/** What is waiting for the student after files were added: unplaced passages and new layers to approve. */
export function getPending(db: Db, projectId: string): Pending {
  const layers = approvedLayers(db, projectId);
  const weeks = new Map(
    db
      .select()
      .from(s.parts)
      .where(eq(s.parts.projectId, projectId))
      .all()
      .map((p) => [p.id, p]),
  );
  const proposedRows = db
    .select({ l: s.layers })
    .from(s.layers)
    .innerJoin(s.parts, eq(s.parts.id, s.layers.partId))
    .where(and(eq(s.parts.projectId, projectId), eq(s.layers.proposed, true)))
    .orderBy(asc(s.layers.position))
    .all()
    .map((r) => r.l);
  const proposed: ProposedLayer[] = proposedRows.map((l) => {
    const rows = db
      .select({ file: s.files.name, role: s.files.role, kind: s.files.kind, pageKind: s.files.pageKind, relPath: s.files.relPath })
      .from(s.layerPassages)
      .innerJoin(s.passages, eq(s.passages.id, s.layerPassages.passageId))
      .innerJoin(s.files, eq(s.files.id, s.passages.fileId))
      .where(eq(s.layerPassages.layerId, l.id))
      .all();
    return {
      id: l.id,
      title: l.title,
      bigQuestion: l.bigQuestion,
      buildsOn: l.buildsOn,
      week: weeks.get(l.partId) ? rowLabel(weeks.get(l.partId)!) : "",
      weekNumber: weeks.get(l.partId)?.week ?? null,
      fromLecture: rows.length > 0 && rows.every((r) => effectiveRole(r) === "lecture"),
      passages: rows.length,
      files: [...new Set(rows.map((r) => r.file))],
    };
  });
  const placedCount = db
    .select({ n: sql<number>`count(distinct ${s.layerPassages.passageId})` })
    .from(s.layerPassages)
    .innerJoin(s.layers, eq(s.layers.id, s.layerPassages.layerId))
    .innerJoin(s.parts, eq(s.parts.id, s.layers.partId))
    .where(eq(s.parts.projectId, projectId))
    .get()!.n;
  const total = db
    .select({ n: sql<number>`count(*)` })
    .from(s.passages)
    .where(eq(s.passages.projectId, projectId))
    .get()!.n;
  return { unplaced: Math.max(0, total - placedCount), proposed, layers: layers.map((l) => ({ id: l.id, title: l.title, week: l.week })) };
}

export interface Decision {
  layerId: string;
  action: "approve" | "merge";
  mergeInto?: string;
  title?: string;
  bigQuestion?: string;
}

/**
 * The student's answer on each proposed layer: approve it (optionally renamed, with its own big question), or add its passages to an
 * existing layer instead. Approved layers go where their material sits in the course. Nothing is written to a layer's tabs here.
 */
export function approveProposals(db: Db, projectId: string, decisions: Decision[]): { approved: number; merged: number } {
  let approved = 0;
  let merged = 0;
  db.transaction((tx) => {
    for (const d of decisions) {
      const row = tx
        .select({ l: s.layers, key: s.parts.key })
        .from(s.layers)
        .innerJoin(s.parts, eq(s.parts.id, s.layers.partId))
        .where(and(eq(s.layers.id, d.layerId), eq(s.parts.projectId, projectId), eq(s.layers.proposed, true)))
        .get();
      if (!row) continue;
      const layer = row.l;
      if (d.action === "merge") {
        const target = tx
          .select({ l: s.layers })
          .from(s.layers)
          .innerJoin(s.parts, eq(s.parts.id, s.layers.partId))
          .where(and(eq(s.layers.id, d.mergeInto ?? ""), eq(s.parts.projectId, projectId), eq(s.layers.proposed, false)))
          .get()?.l;
        if (!target) throw new UpdateError("Pick one of the course's layers to add this material to.");
        tx.update(s.layerPassages).set({ layerId: target.id }).where(eq(s.layerPassages.layerId, layer.id)).run();
        tx.delete(s.layers).where(eq(s.layers.id, layer.id)).run();
        resortLayer(tx, target.id);
        markNewMaterial(tx, target.id);
        merged++;
        continue;
      }
      const title = (d.title ?? layer.title).trim();
      const bigQuestion = (d.bigQuestion ?? layer.bigQuestion).trim();
      if (!title || !bigQuestion) throw new UpdateError("A layer needs a title and a big question.");
      const anchor =
        tx.get<{ pos: number }>(
          sql`select min(u.position) as pos from layer_passages lp join passages p on p.id = lp.passage_id join sections sc on sc.id = p.section_id join units u on u.id = sc.unit_id where lp.layer_id = ${layer.id}`,
        )?.pos ?? 0;
      const siblings = tx
        .select()
        .from(s.layers)
        .where(and(eq(s.layers.partId, layer.partId), eq(s.layers.proposed, false)))
        .orderBy(asc(s.layers.position))
        .all();
      let after = -1;
      siblings.forEach((sib, i) => {
        const at = tx.get<{ pos: number | null }>(
          sql`select min(u.position) as pos from layer_passages lp join passages p on p.id = lp.passage_id join sections sc on sc.id = p.section_id join units u on u.id = sc.unit_id where lp.layer_id = ${sib.id}`,
        )?.pos;
        if (at !== null && at !== undefined && at <= anchor) after = i;
      });
      const position = after + 1;
      tx.update(s.layers)
        .set({ position: sql`${s.layers.position} + 1` })
        .where(and(eq(s.layers.partId, layer.partId), eq(s.layers.proposed, false), sql`${s.layers.position} >= ${siblings[position]?.position ?? 1e9}`))
        .run();
      tx.update(s.layers)
        .set({ title, bigQuestion, proposed: false, position: siblings[position]?.position ?? siblings.length })
        .where(eq(s.layers.id, layer.id))
        .run();
      closeGaps(tx, layer.partId);
      approved++;
    }
    // a week made for new material is approved once every layer proposed for it is decided; one left with no layers goes
    for (const part of partRows(tx, projectId)) {
      if (part.breakdownStatus === "approved") continue;
      const rows = tx.select({ proposed: s.layers.proposed }).from(s.layers).where(eq(s.layers.partId, part.id)).all();
      if (!rows.length) tx.delete(s.parts).where(eq(s.parts.id, part.id)).run();
      else if (rows.every((r) => !r.proposed)) tx.update(s.parts).set({ breakdownStatus: "approved", approvedAt: Date.now() }).where(eq(s.parts.id, part.id)).run();
    }
  });
  return { approved, merged };
}
