import { asc, eq, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { stripInvalidCitations } from "@/lib/ai/citations";
import type { Engine } from "@/lib/ai/engine";
import { pickClassNotes, writeLectureTab } from "@/lib/ai/tasks";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { effectiveRole } from "@/lib/updates/classify";
import { getCourseWeeks } from "@/lib/updates/service";
import { weekOfUnit } from "@/lib/updates/weeks";
import { GateError, loadLayer, passagesOfLayer, refreshLayer, StructureError } from "@/lib/layers/service";
import { getWeekNotes } from "@/lib/weeks/notes";
import { lectureFacts } from "./facts";
import type { ClassNotes, LectureSlide } from "./types";

const READING_CAP = 40;

interface Gathered {
  layer: typeof s.layers.$inferSelect;
  partOk: boolean;
  /** The layer's passages, with what kind of file each came from. */
  lecture: { file: string; fileId: string; page: number; text: string }[];
  reading: { file: string; page: number; text: string }[];
  weeks: number[];
}

/** The layer's passages split into lecture slides and readings (by the file's label), and the weeks its files belong to. */
function gather(db: Db, layerId: string): Gathered {
  const { layer, part } = loadLayer(db, layerId);
  const ordered = passagesOfLayer(db, layerId);
  const ids = ordered.map((p) => p.passageId);
  const meta = ids.length
    ? db
        .select({ id: s.passages.id, fileId: s.files.id, name: s.files.name, kind: s.files.kind, pageKind: s.files.pageKind, role: s.files.role, relPath: s.files.relPath, week: s.files.week, unit: s.units.title })
        .from(s.passages)
        .innerJoin(s.files, eq(s.files.id, s.passages.fileId))
        .leftJoin(s.units, eq(s.units.id, s.files.unitId))
        .where(inArray(s.passages.id, ids))
        .all()
    : [];
  const byId = new Map(meta.map((m) => [m.id, m]));
  const lecture: Gathered["lecture"] = [];
  const reading: Gathered["reading"] = [];
  const weeks = new Set<number>();
  for (const p of ordered) {
    const m = byId.get(p.passageId);
    if (!m) continue;
    const w = m.week ?? (m.unit ? weekOfUnit(m.unit) : null);
    if (w) weeks.add(w);
    const role = effectiveRole(m);
    if (role === "lecture") lecture.push({ file: p.file, fileId: m.fileId, page: p.page, text: p.text });
    else if (role === "reading") reading.push({ file: p.file, page: p.page, text: p.text });
  }
  return { layer, partOk: part.breakdownStatus === "approved", lecture, reading, weeks: [...weeks].sort((a, b) => a - b) };
}

/** The lecture slides of a layer with their structure: each slide's heading and lines as written, read from the sections' stored blocks. */
export function slidesOf(db: Db, lecture: Gathered["lecture"]): LectureSlide[] {
  const pages = new Map<string, { file: string; pages: Set<number> }>();
  for (const p of lecture) (pages.get(p.fileId) ?? pages.set(p.fileId, { file: p.file, pages: new Set() }).get(p.fileId)!).pages.add(p.page);
  const out: LectureSlide[] = [];
  for (const [fileId, { file, pages: wanted }] of pages) {
    const blocks = db.select({ original: s.sections.original }).from(s.sections).where(eq(s.sections.fileId, fileId)).orderBy(asc(s.sections.position)).all().flatMap((r) => r.original);
    const byPage = new Map<number, { heading: string | null; lines: string[] }>();
    for (const b of blocks) {
      if (!wanted.has(b.page)) continue;
      const slide = byPage.get(b.page) ?? byPage.set(b.page, { heading: null, lines: [] }).get(b.page)!;
      if (b.kind === "heading" && slide.heading === null) slide.heading = b.text;
      else slide.lines.push(...b.text.split("\n").map((l) => l.trim()).filter(Boolean));
    }
    for (const page of [...byPage.keys()].sort((a, b) => a - b)) out.push({ file, page, ...byPage.get(page)! });
  }
  return out;
}

export const lectureFilesOf = (db: Db, layerId: string): string[] => [...new Set(gather(db, layerId).lecture.map((p) => p.file))];

// ---------------------------------------------------------------- the student's own lecture notes

interface Line {
  n: number;
  week: number;
  text: string;
}

/** The student's lecture-notes lines for the weeks the layer draws on, numbered across weeks. */
function noteLines(db: Db, projectId: string, weeks: number[]): Line[] {
  const lines: Line[] = [];
  for (const week of weeks) for (const b of getWeekNotes(db, projectId, week).blocks) if (b.text.trim()) lines.push({ n: lines.length + 1, week, text: b.text.trim() });
  return lines;
}
const hashOf = (lines: Line[]) => createHash("sha256").update(JSON.stringify(lines.map((l) => [l.week, l.text]))).digest("hex").slice(0, 16);

/** Choose which of the student's lines belong to this layer. The lines themselves are copied by code, exactly as written; an unknown number is dropped. */
async function buildNotes(db: Db, engine: Engine, projectId: string, g: Gathered, lines: Line[], signal?: AbortSignal): Promise<ClassNotes> {
  const dates = new Map(getCourseWeeks(db, projectId).weeks.map((w) => [w.week, w.date]));
  const withNotes = new Set(lines.map((l) => l.week));
  const base = { weeksDrawn: g.weeks, empty: g.weeks.filter((w) => !withNotes.has(w)) };
  if (!lines.length) return { ...base, weeks: [], checks: [] };
  const slides = g.lecture.map((p) => ({ file: p.file, page: p.page, text: p.text.slice(0, 700) }));
  const pick = await pickClassNotes(engine, { layer: { title: g.layer.title, bigQuestion: g.layer.bigQuestion }, slides, lines }, signal);
  const valid = new Set(lines.map((l) => l.n));
  const chosen = new Set(pick.relevant.filter((n) => valid.has(n)));
  return {
    ...base,
    weeks: g.weeks.filter((w) => withNotes.has(w)).map((week) => ({ week, date: dates.get(week) ?? null, lines: lines.filter((l) => l.week === week && chosen.has(l.n)).map((l) => l.text) })),
    checks: pick.checks.filter((c) => valid.has(c.line)).map((c) => stripInvalidCitations(c.text, slides).text).slice(0, 3),
  };
}

// ---------------------------------------------------------------- the Lecture tab

export interface LectureTab {
  /** The lecture files that have text in this layer. Empty: "No lecture files for this layer yet". */
  files: string[];
  content: { facts: s.LectureFactsJson; writing: s.LectureWritingJson; notes: ClassNotes; writtenAt: number } | null;
  /** The lecture notes changed since the class-notes section was made, so it is made again when the tab opens. */
  notesStale: boolean;
}

/** What the layer's Lecture tab shows now. Reads only; nothing is written and no AI is asked. */
export function getLectureTab(db: Db, layerId: string): LectureTab {
  const g = gather(db, layerId);
  const files = [...new Set(g.lecture.map((p) => p.file))];
  const row = db.select().from(s.layerLecture).where(eq(s.layerLecture.layerId, layerId)).get();
  const stale = row ? hashOf(noteLines(db, loadLayer(db, layerId).part.projectId, g.weeks)) !== row.notesHash : false;
  return { files, content: row ? { facts: row.facts, writing: row.writing, notes: row.notes, writtenAt: row.writtenAt } : null, notesStale: stale };
}

// on globalThis: the background worker and the routes load separate copies of this module, and must share one list
const inflight = ((globalThis as unknown as Record<string, Map<string, Promise<void>>>).__margin_lecture_inflight__ ??= new Map<string, Promise<void>>());

/**
 * Write the Lecture tab, once, the first time it is opened. Only the layer's files labelled Lecture are used. The numbers are counted by code;
 * the model writes the prose from them (Opus, citations checked against the slides and reading sent); a second, cheaper call picks which of
 * the student's own lecture notes belong here. Already written: the class-notes section is made again only if the lecture notes changed.
 * `force` writes it all again (Refresh this layer); the old tab stays until the new one is ready.
 */
export function writeLecture(db: Db, engine: Engine, layerId: string, { force = false, signal }: { force?: boolean; signal?: AbortSignal } = {}): Promise<void> {
  const g = gather(db, layerId);
  if (!g.partOk) throw new GateError("Approve the course plan first. Nothing is written until you do.");
  const projectId = loadLayer(db, layerId).part.projectId;
  const row = db.select().from(s.layerLecture).where(eq(s.layerLecture.layerId, layerId)).get();
  if (!g.lecture.length) {
    if (row) db.delete(s.layerLecture).where(eq(s.layerLecture.layerId, layerId)).run(); // its lecture files are gone
    throw new StructureError("No lecture files for this layer yet. Add files labelled Lecture and they will show here.");
  }
  const running = inflight.get(layerId);
  if (running) return running;

  const job = (async () => {
    const lines = noteLines(db, projectId, g.weeks);
    if (row && !force) {
      if (hashOf(lines) === row.notesHash) return;
      const notes = await buildNotes(db, engine, projectId, g, lines, signal);
      db.update(s.layerLecture).set({ notes, notesHash: hashOf(lines) }).where(eq(s.layerLecture.layerId, layerId)).run();
      return;
    }
    const facts = lectureFacts(slidesOf(db, g.lecture));
    const { writing } = await writeLectureTab(
      engine,
      {
        layer: { title: g.layer.title, bigQuestion: g.layer.bigQuestion },
        facts,
        slides: g.lecture.map((p) => ({ file: p.file, page: p.page, text: p.text })),
        reading: g.reading.slice(0, READING_CAP),
      },
      signal,
    );
    const notes = await buildNotes(db, engine, projectId, g, lines, signal);
    db.transaction((tx) => {
      tx.delete(s.layerLecture).where(eq(s.layerLecture.layerId, layerId)).run();
      tx.insert(s.layerLecture).values({ id: nanoid(10), layerId, facts, writing, notes, notesHash: hashOf(lines) }).run();
    });
  })().finally(() => inflight.delete(layerId));
  inflight.set(layerId, job);
  return job;
}

/**
 * "Refresh this layer": Explained is written again, and so is the Lecture tab if it had been written. The student's write-up, saved version
 * and chat are never touched. Lecture notes are only read, never changed.
 */
export async function refreshLayerAndLecture(db: Db, engine: Engine, layerId: string, signal?: AbortSignal): Promise<void> {
  await refreshLayer(db, engine, layerId, signal);
  const had = db.select({ id: s.layerLecture.id }).from(s.layerLecture).where(eq(s.layerLecture.layerId, layerId)).get();
  if (!had) return;
  if (!lectureFilesOf(db, layerId).length) db.delete(s.layerLecture).where(eq(s.layerLecture.layerId, layerId)).run();
  else await writeLecture(db, engine, layerId, { force: true, signal });
}

