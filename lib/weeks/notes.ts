import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { getCourseWeeks } from "@/lib/updates/service";
import type { NoteBlock } from "@/lib/talk/notepad";

export const MAX_WEEK = 60;
export const validWeek = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_WEEK;

export interface WeekNotes {
  blocks: NoteBlock[];
  updatedAt: number | null;
}

const hasText = (blocks: NoteBlock[]) => blocks.some((b) => b.text.trim());

export function getWeekNotes(db: Db, projectId: string, week: number): WeekNotes {
  const row = db.select().from(s.weekNotes).where(and(eq(s.weekNotes.projectId, projectId), eq(s.weekNotes.week, week))).get();
  return row ? { blocks: row.blocks, updatedAt: row.updatedAt } : { blocks: [], updatedAt: null };
}

/** Autosave of one week's page. A page emptied of text is removed, so "No notes yet" is true again. */
export function saveWeekNotes(db: Db, projectId: string, week: number, blocks: NoteBlock[]): WeekNotes {
  const updatedAt = Date.now();
  if (!hasText(blocks)) {
    db.delete(s.weekNotes).where(and(eq(s.weekNotes.projectId, projectId), eq(s.weekNotes.week, week))).run();
    return { blocks: [], updatedAt: null };
  }
  db.insert(s.weekNotes).values({ projectId, week, blocks, updatedAt }).onConflictDoUpdate({ target: [s.weekNotes.projectId, s.weekNotes.week], set: { blocks, updatedAt } }).run();
  return { blocks, updatedAt };
}

export interface WeekSummary {
  week: number;
  /** The date the syllabus gives for this week, as written. Null when the syllabus has none. */
  date: string | null;
  hasNotes: boolean;
}

/** Every week of the course with its date (if known) and whether the student has written anything for it. */
export function weekSummary(db: Db, projectId: string): WeekSummary[] {
  const { weeks } = getCourseWeeks(db, projectId);
  const written = new Set(db.select().from(s.weekNotes).where(eq(s.weekNotes.projectId, projectId)).all().filter((r) => hasText(r.blocks)).map((r) => r.week));
  return weeks.map((w) => ({ week: w.week, date: w.date, hasNotes: written.has(w.week) }));
}
