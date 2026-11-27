import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Engine, Priority } from "@/lib/ai/engine";
import { requeue } from "@/lib/ai/queue";
import { writeLectureSection } from "@/lib/ai/tasks";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { GateError } from "@/lib/layers/service";
import { endLecturePart, finishLecture, setLectureText, startLecture, weekKey, type LecturePart } from "./progress";
import { courseSources, factsByFile, hasLectureTab, LECTURE_WORDS, capWords, passagesForNotes, readingsForMaterial, type WeekSources } from "./sources";

/**
 * The Lecture tab of one week, the same in every layer of that week, in two sections:
 *  - "From your lecture notes": what the lecture covered according to the student's notes for the week, each point expanded a little from
 *    the week's readings and lecture material and pointed back to them; points only in the notes are marked "(from your notes)".
 *  - "From the lecture material": what the lecture material the professor posted spent its time on, what it stressed, its examples and
 *    where it differs from the readings, with a part per lecture when the week has two.
 * Each section is written once and stored with a hash of its sources; it is written again only when they change: the notes section once
 * the student has stopped editing that week's notes (`schedule.ts`), the material section when the week's files change. Never on a keystroke.
 */

export const PARTS: LecturePart[] = ["notes", "material"];

export interface LectureSection {
  text: string;
  writtenAt: number;
  /** What it was written from has changed since: it is written again (the old text shows until the new one arrives). */
  stale: boolean;
}

export interface WeekLecture {
  week: number;
  /** The week's lecture files, by name. None: section 2 is left out. */
  files: string[];
  hasNotes: boolean;
  notes: LectureSection | null;
  material: LectureSection | null;
}

/** Whether the course's week has a Lecture tab: lecture material or notes. Neither: its layers show only Explained and Source. */
export const weekHasLecture = (tab: Pick<WeekLecture, "files" | "hasNotes">) => tab.files.length > 0 || tab.hasNotes;

const rowsOf = (db: Db, projectId: string, week: number) => db.select().from(s.weekLecture).where(and(eq(s.weekLecture.projectId, projectId), eq(s.weekLecture.week, week))).all();

function view(week: number, src: WeekSources, rows: (typeof s.weekLecture.$inferSelect)[]): WeekLecture {
  const section = (part: LecturePart): LectureSection | null => {
    const want = src.hash[part];
    const row = rows.find((r) => r.part === part);
    return want && row ? { text: row.text, writtenAt: row.writtenAt, stale: row.sourceHash !== want } : null;
  };
  return { week, files: [...new Set(src.lecture.map((p) => p.file))], hasNotes: src.notes.length > 0, notes: section("notes"), material: section("material") };
}

/** What the week's Lecture tab shows now. Reads only; nothing is written and no AI is asked. */
export function getWeekLecture(db: Db, projectId: string, week: number): WeekLecture {
  return view(week, courseSources(db, projectId).get(week) ?? { lecture: [], reading: [], notes: [], notesAt: null, hash: { notes: null, material: null } }, rowsOf(db, projectId, week));
}

/** The sections of a week that need writing: never written, or written from sources that have changed since. */
export function partsToWrite(src: WeekSources, rows: { part: string; sourceHash: string }[]): LecturePart[] {
  return PARTS.filter((p) => src.hash[p] && rows.find((r) => r.part === p)?.sourceHash !== src.hash[p]);
}

// ---------------------------------------------------------------- writing

/** How long after the last edit of a week's notes the notes section is written again: MARGIN_LECTURE_QUIET_S (seconds), 3 minutes by default. */
export function lectureQuietMs(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.MARGIN_LECTURE_QUIET_S);
  return Number.isFinite(n) && n >= 0 ? n * 1000 : 180_000;
}

/** Whether the student has stopped editing the notes: the last save is older than the quiet time, or they left the notes page since. Pure. */
export const notesQuiet = (notesAt: number | null, now: number, quietMs: number, leftAt = 0) => notesAt === null || now - notesAt >= quietMs || leftAt >= notesAt;

// on globalThis: the background worker and the routes load separate copies of this module, and must share one list
const shared = globalThis as unknown as Record<string, unknown>;
const inflight = (shared.__margin_lecture_inflight__ ??= new Map<string, Promise<void>>()) as Map<string, Promise<void>>;
const priorities = (shared.__margin_lecture_priority__ ??= new Map<string, Priority>()) as Map<string, Priority>;
/** When the student last left a week's Lecture notes page. */
const leftAt = (shared.__margin_lecture_left__ ??= new Map<string, number>()) as Map<string, number>;

export const isWritingLecture = (projectId: string, week: number) => inflight.has(weekKey(projectId, week));
export const noteLeft = (projectId: string, week: number, at = Date.now()) => void leftAt.set(weekKey(projectId, week), at);
export const leftNotesAt = (projectId: string, week: number) => leftAt.get(weekKey(projectId, week)) ?? 0;

/** The course name and the week as the syllabus gives it, for the prompts. */
function weekFacts(db: Db, projectId: string, week: number) {
  const course = db.select({ name: s.projects.name }).from(s.projects).where(eq(s.projects.id, projectId)).get()?.name ?? "";
  const row = db.select().from(s.courseWeeks).where(and(eq(s.courseWeeks.projectId, projectId), eq(s.courseWeeks.week, week))).get();
  return { course, week, title: row?.title ?? "", syllabus: row?.syllabus ?? "" };
}

const asPassage = (p: { file: string; page: number; text: string }) => ({ file: p.file, page: p.page, text: p.text });

async function writePart(db: Db, engine: Engine, projectId: string, week: number, part: LecturePart, src: WeekSources, signal?: AbortSignal) {
  const key = weekKey(projectId, week);
  const call = { signal, priority: () => priorities.get(key) ?? "background", onText: (t: string) => setLectureText(key, part, t) };
  const facts = weekFacts(db, projectId, week);
  const text =
    part === "notes"
      ? await writeLectureSection(engine, { kind: "notes", prompt: { week: facts, notes: src.notes, passages: passagesForNotes(db, projectId, src).map(asPassage) } }, call)
      : await writeLectureSection(
          engine,
          {
            kind: "material",
            prompt: {
              week: facts,
              files: factsByFile(db, src.lecture).map(({ file, facts: f }) => ({ file, facts: f, passages: capWords(src.lecture, LECTURE_WORDS).filter((p) => p.file === file).map(asPassage) })),
              reading: readingsForMaterial(db, projectId, src).map(asPassage),
            },
          },
          call,
        );
  // the sources may have changed while it was written: it is stored with the hash it was written from, so it is written again if so
  db.insert(s.weekLecture)
    .values({ id: nanoid(10), projectId, week, part, text, sourceHash: src.hash[part]!, writtenAt: Date.now() })
    .onConflictDoUpdate({ target: [s.weekLecture.projectId, s.weekLecture.week, s.weekLecture.part], set: { text, sourceHash: src.hash[part]!, writtenAt: Date.now() } })
    .run();
}

/**
 * Write whichever sections of a week's Lecture tab are missing or out of date, side by side, streaming each into the page as it comes
 * (`progress.ts`). A section whose sources are gone (the notes emptied, the lecture files removed) is deleted. `quietOnly` (the background)
 * leaves the notes section while the student is still editing them. Already being written: joined, and moved to "now" if the student opened it.
 * A section that fails keeps its old text; the error is passed on after the other section is saved.
 */
export function writeWeekLecture(db: Db, engine: Engine, projectId: string, week: number, { priority = "background", quietOnly = false, signal }: { priority?: Priority; quietOnly?: boolean; signal?: AbortSignal } = {}): Promise<void> {
  const key = weekKey(projectId, week);
  const running = inflight.get(key);
  if (running) {
    if (priority === "now" && priorities.get(key) !== "now") {
      priorities.set(key, "now");
      requeue();
    }
    return running;
  }
  const part = db.select({ status: s.parts.breakdownStatus }).from(s.parts).where(and(eq(s.parts.projectId, projectId), eq(s.parts.week, week))).get();
  if (part?.status !== "approved") throw new GateError("Approve the course plan first. Nothing is written until you do.");
  const src = courseSources(db, projectId).get(week);
  const rows = rowsOf(db, projectId, week);
  for (const r of rows) if (!src?.hash[r.part]) db.delete(s.weekLecture).where(eq(s.weekLecture.id, r.id)).run();
  if (!src || !hasLectureTab(src)) return Promise.resolve();
  const parts = partsToWrite(src, rows).filter((p) => p !== "notes" || !quietOnly || notesQuiet(src.notesAt, Date.now(), lectureQuietMs(), leftNotesAt(projectId, week)));
  if (!parts.length) return Promise.resolve();

  priorities.set(key, priority);
  startLecture(key, parts);
  const job = (async () => {
    const results = await Promise.allSettled(
      parts.map((p) =>
        writePart(db, engine, projectId, week, p, src, signal).finally(() => endLecturePart(key, p)),
      ),
    );
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) throw failed.reason;
  })().finally(() => {
    inflight.delete(key);
    priorities.delete(key);
    finishLecture(key);
  });
  inflight.set(key, job);
  return job;
}

/**
 * The next week whose Lecture tab the background should write, or null: first a section written before whose sources have changed (the
 * week's files changed, or the notes, once the student stopped editing them), then, with `missing`, a section never written, in approved
 * weeks whose layers are all written. Demo courses are left alone (their tabs are written when opened).
 */
export function nextLectureWeek(db: Db, { missing, firstProject = null, skip = () => false }: { missing: boolean; firstProject?: string | null; skip?: (projectId: string, week: number) => boolean }): { projectId: string; week: number } | null {
  const projects = db.select({ id: s.projects.id, createdAt: s.projects.createdAt }).from(s.projects).where(and(eq(s.projects.isDemo, false), eq(s.projects.status, "ready"))).all();
  projects.sort((a, b) => Number(b.id === firstProject) - Number(a.id === firstProject) || b.createdAt - a.createdAt);
  const now = Date.now();
  for (const p of projects) {
    const approved = db.select({ id: s.parts.id, week: s.parts.week }).from(s.parts).where(and(eq(s.parts.projectId, p.id), eq(s.parts.breakdownStatus, "approved"))).all();
    if (!approved.length) continue;
    const rows = db.select({ week: s.weekLecture.week, part: s.weekLecture.part, sourceHash: s.weekLecture.sourceHash }).from(s.weekLecture).where(eq(s.weekLecture.projectId, p.id)).all();
    const unwritten = missing
      ? new Set(db.select({ partId: s.layers.partId }).from(s.layers).where(and(eq(s.layers.contentStatus, "none"), eq(s.layers.proposed, false))).all().map((r) => r.partId))
      : new Set<string>();
    const sources = courseSources(db, p.id);
    for (const row of approved.sort((a, b) => (a.week ?? 0) - (b.week ?? 0))) {
      const week = row.week;
      if (week === null || isWritingLecture(p.id, week) || skip(p.id, week)) continue;
      const src = sources.get(week);
      if (!src || !hasLectureTab(src)) continue;
      const mine = rows.filter((r) => r.week === week);
      const due = partsToWrite(src, mine).filter((part) => part !== "notes" || notesQuiet(src.notesAt, now, lectureQuietMs(), leftNotesAt(p.id, week)));
      const stale = due.filter((part) => mine.some((r) => r.part === part));
      if (stale.length || (missing && due.length && !unwritten.has(row.id))) return { projectId: p.id, week };
    }
  }
  return null;
}
