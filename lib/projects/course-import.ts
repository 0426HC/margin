/**
 * Writing what the AI read into the database: the course's weeks (`course_weeks`), what it couldn't find (`ui_state` "course-map"),
 * units by week, and the student's own notes copied into Lecture notes. The reading itself is `lib/import/organize.ts`.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import type { MappedWeek } from "@/lib/import/organize";
import type { Block } from "@/lib/import/types";
import type { NoteBlock } from "@/lib/talk/notepad";
import { sha256 } from "./hash";

type FileRow = typeof s.files.$inferSelect;

// ---------------------------------------------------------------- the course's weeks, as the syllabus states them

export function saveCourseWeeks(db: Db, projectId: string, weeks: MappedWeek[]) {
  db.delete(s.courseWeeks).where(eq(s.courseWeeks.projectId, projectId)).run();
  for (const w of weeks) db.insert(s.courseWeeks).values({ projectId, week: w.week, date: w.date, title: w.title, kind: w.kind, syllabus: w.syllabus }).run();
}

export function courseWeekRows(db: Db, projectId: string) {
  return db.select().from(s.courseWeeks).where(eq(s.courseWeeks.projectId, projectId)).orderBy(asc(s.courseWeeks.week)).all();
}

// ---------------------------------------------------------------- what the import couldn't do or find

export interface CourseMapNote {
  /** The AI's answer couldn't be used: why, in plain words. The files are unlabelled until the student labels them. */
  failed: string | null;
  /** Syllabus readings no file matched. */
  missingReadings: { week: number | null; reading: string }[];
  /** Files the syllabus doesn't mention (ids). */
  notInSyllabus: string[];
  /** Breaks the syllabus doesn't number (a reading week), each after a numbered week. */
  breaks: { afterWeek: number; date: string | null; title: string }[];
  /** What the final check said about the course as a whole. */
  review: string[];
}

const MAP_KEY = "course-map";

export function getCourseMapNote(db: Db, projectId: string): CourseMapNote {
  const v = (db.select({ v: s.uiState.value }).from(s.uiState).where(and(eq(s.uiState.projectId, projectId), eq(s.uiState.key, MAP_KEY))).get()?.v ?? null) as Partial<CourseMapNote> | null;
  return { failed: v?.failed ?? null, missingReadings: v?.missingReadings ?? [], notInSyllabus: v?.notInSyllabus ?? [], breaks: v?.breaks ?? [], review: v?.review ?? [] };
}

export function setCourseMapNote(db: Db, projectId: string, note: CourseMapNote) {
  db.insert(s.uiState)
    .values({ id: `${projectId}:${MAP_KEY}`, projectId, key: MAP_KEY, value: note })
    .onConflictDoUpdate({ target: [s.uiState.projectId, s.uiState.key], set: { value: note } })
    .run();
}

// ---------------------------------------------------------------- the student's own notes

/** A notes file as Lecture notes blocks: headings stay headings, list lines become bullets, the rest paragraphs. */
export function notesBlocks(blocks: Block[]): NoteBlock[] {
  const out: NoteBlock[] = [];
  for (const b of blocks) {
    if (b.kind === "heading") out.push({ type: "heading", text: b.text.trim() });
    else if (b.kind === "list")
      for (const line of b.text.split(/\n+/)) {
        const t = line.replace(/^\s*(?:[-*•–]|\d+[.)])\s*/, "").trim();
        if (t) out.push({ type: "bullet", text: t });
      }
    else if (b.text.trim()) out.push({ type: "paragraph", text: b.text.trim() });
  }
  return out;
}

/**
 * Copy a notes file into its week's Lecture notes page, below anything already there (never replacing it), under a small heading that
 * says which file it came from. Remembered, so Update from folder can offer only what a changed file adds.
 */
export function importNotesFile(db: Db, projectId: string, f: FileRow, week: number) {
  const blocks = notesBlocks(f.parsed ?? []);
  if (!blocks.length) return;
  const page = db.select().from(s.weekNotes).where(and(eq(s.weekNotes.projectId, projectId), eq(s.weekNotes.week, week))).get();
  const next = [...(page?.blocks ?? []), { type: "heading" as const, text: `From ${f.name}` }, ...blocks];
  const updatedAt = Date.now();
  db.insert(s.weekNotes).values({ projectId, week, blocks: next, updatedAt }).onConflictDoUpdate({ target: [s.weekNotes.projectId, s.weekNotes.week], set: { blocks: next, updatedAt } }).run();
  const text = blocks.map((b) => b.text).join("\n");
  db.insert(s.noteImports).values({ id: nanoid(10), projectId, fileId: f.id, relPath: f.relPath, week, hash: f.contentHash ?? sha256(new TextEncoder().encode(text)), text }).run();
}

/**
 * Cut what a file brought into one Lecture notes page: each run headed "From <file>" or "New in <file>", with the blocks under it that are
 * still exactly as copied from the file. Anything the student wrote or changed stays on the page. Returns the page without them and what
 * was cut, or null when the page holds nothing of this file.
 */
function cutCopied(blocks: NoteBlock[], f: Pick<FileRow, "name" | "parsed">): { rest: NoteBlock[]; cut: NoteBlock[] } | null {
  const heads = new Set([`From ${f.name}`, `New in ${f.name}`]);
  const lines = new Set(notesBlocks(f.parsed ?? []).map((b) => b.text));
  const rest: NoteBlock[] = [];
  const cut: NoteBlock[] = [];
  let inRun = false;
  for (const b of blocks) {
    if (b.type === "heading" && heads.has(b.text)) {
      inRun = true;
      cut.push(b);
    } else if (inRun && lines.has(b.text)) cut.push(b);
    else {
      inRun = false;
      rest.push(b);
    }
  }
  return cut.length ? { rest, cut } : null;
}

function writePage(db: Db, projectId: string, week: number, blocks: NoteBlock[]) {
  const updatedAt = Date.now();
  if (!blocks.some((b) => b.text.trim())) db.delete(s.weekNotes).where(and(eq(s.weekNotes.projectId, projectId), eq(s.weekNotes.week, week))).run();
  else db.insert(s.weekNotes).values({ projectId, week, blocks, updatedAt }).onConflictDoUpdate({ target: [s.weekNotes.projectId, s.weekNotes.week], set: { blocks, updatedAt } }).run();
}

/** Move what a notes file brought into Lecture notes from one week's page to another (only what is still as copied). */
export function moveImportedNotes(db: Db, projectId: string, f: FileRow, from: number, to: number) {
  const page = db.select().from(s.weekNotes).where(and(eq(s.weekNotes.projectId, projectId), eq(s.weekNotes.week, from))).get();
  const found = page && cutCopied(page.blocks, f);
  if (!found) return;
  writePage(db, projectId, from, found.rest);
  const target = db.select().from(s.weekNotes).where(and(eq(s.weekNotes.projectId, projectId), eq(s.weekNotes.week, to))).get();
  writePage(db, projectId, to, [...(target?.blocks ?? []), ...found.cut]);
  db.update(s.noteImports).set({ week: to }).where(eq(s.noteImports.fileId, f.id)).run();
}

/**
 * A file that is no longer the student's own notes (it was relabelled, or a new import reads it as lecture material) takes its copy out of
 * Lecture notes: only Lecture material's own Lecture tab shows it now. What the student wrote on those pages stays.
 */
export function removeImportedNotes(db: Db, projectId: string, f: FileRow) {
  for (const page of db.select().from(s.weekNotes).where(eq(s.weekNotes.projectId, projectId)).all()) {
    const found = cutCopied(page.blocks, f);
    if (found) writePage(db, projectId, page.week, found.rest);
  }
  db.delete(s.noteImports).where(eq(s.noteImports.fileId, f.id)).run();
}

/** Once per database open: copies in Lecture notes of files that are not the student's notes (from before Round 2) are taken out. */
export function removeStrayNoteCopies(db: Db) {
  // a database whose migrations haven't reached Round 2 yet (the app folder is older than the code) has nothing to tidy
  if (!db.all<{ name: string }>(sql`pragma table_info(files)`).some((c) => c.name === "author")) return;
  const stray = db
    .select({ file: s.files })
    .from(s.noteImports)
    .innerJoin(s.files, eq(s.files.id, s.noteImports.fileId))
    .all()
    .map((r) => r.file)
    .filter((f) => f.category !== "notes");
  for (const f of new Map(stray.map((x) => [x.id, x])).values()) db.transaction((tx) => removeImportedNotes(tx, f.projectId, f));
}

/** Lines of a changed notes file that the copy in Lecture notes doesn't have yet. */
export function newNoteLines(before: string, after: Block[]): NoteBlock[] {
  const had = new Set(before.split("\n").map((l) => l.trim().toLowerCase()));
  return notesBlocks(after).filter((b) => !had.has(b.text.trim().toLowerCase()));
}

// ---------------------------------------------------------------- units by week

/** One unit per week ("Week 3: Congress"), the syllabus first, optional readings last. Only labelled files are placed. */
export function unitPlan(files: FileRow[], titles: Map<number, string>): { key: string; title: string; isOverview: boolean; fileIds: string[] }[] {
  const units = new Map<string, { key: string; title: string; isOverview: boolean; fileIds: string[]; order: number }>();
  const add = (key: string, title: string, order: number, id: string, isOverview = false) => {
    const u = units.get(key) ?? { key, title, isOverview, fileIds: [], order };
    u.fileIds.push(id);
    units.set(key, u);
  };
  for (const f of files) {
    if (f.category === "syllabus") add("overview", "Course overview", -1, f.id, true);
    else if (f.category === "optional") add("optional", "Optional readings", 10_000, f.id);
    else if (f.category === "course" && f.week !== null) add(`week-${f.week}`, titles.get(f.week) ? `Week ${f.week}: ${titles.get(f.week)}` : `Week ${f.week}`, f.week, f.id);
  }
  return [...units.values()].sort((a, b) => a.order - b.order).map(({ key, title, isOverview, fileIds }) => ({ key, title, isOverview, fileIds }));
}
