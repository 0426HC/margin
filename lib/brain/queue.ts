/**
 * The order the brain reads in. The queue is the database: every course file of a course that is imported (planned or not) with no
 * `brain_reads` row yet. Within a course: the current week's files first, then the next week's, then the rest in week order. The course the
 * student last opened comes first, then the others, newest first. A stopped or sleeping Margin simply carries on with the next unread file.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { courseWeekRows } from "@/lib/projects/course-import";
import { currentWeek } from "@/lib/weeks/current";
import { fileWeeks } from "./store";

const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** The order to read one course's files in: the current week, the next week, then every other week in order. Pure. */
export function readingRank(files: { id: string; name: string; weeks: number[] }[], current: number): string[] {
  const rank = (ws: number[]) => (ws.includes(current) ? 0 : ws.includes(current + 1) ? 1 : 2);
  const first = (ws: number[]) => (ws.length ? Math.min(...ws) : Infinity);
  return [...files].sort((a, b) => rank(a.weeks) - rank(b.weeks) || first(a.weeks) - first(b.weeks) || natural.compare(a.name, b.name)).map((f) => f.id);
}

/** The week a course is in, from the syllabus's dates (week 1 when it has none). */
export function courseCurrentWeek(db: Db, projectId: string, now = new Date()): number {
  return currentWeek(courseWeekRows(db, projectId).map((w) => ({ week: w.week, date: w.date, hasNotes: false })), now);
}

/** Files a layer being written needs read, most recent first: read before anything else. In memory, on globalThis (dev reloads). */
const WANT = "__margin_brain_wanted__";
const wanted = (): string[] => ((globalThis as unknown as Record<string, string[]>)[WANT] ??= []);

/** A layer is being written from these files: the brain reads the unread ones next, so its named-things check can run soon after. */
export function wantBrainFiles(fileIds: string[]) {
  const g = globalThis as unknown as Record<string, string[]>;
  g[WANT] = [...fileIds, ...wanted().filter((id) => !fileIds.includes(id))].slice(0, 200);
}

/**
 * The next file to read: `{ projectId, fileId }`, or null when every course is read. Files a layer being written needs come first
 * (`wantBrainFiles`), then the queue's own order. The demo comes ready and is never read.
 */
export function nextBrainFile(db: Db, firstProject: string | null = null, skip: (fileId: string) => boolean = () => false): { projectId: string; fileId: string } | null {
  const want = wanted();
  if (want.length) {
    const read = new Set(db.select({ id: s.brainReads.fileId }).from(s.brainReads).where(inArray(s.brainReads.fileId, want)).all().map((r) => r.id));
    const rows = db.select({ id: s.files.id, projectId: s.files.projectId }).from(s.files).where(inArray(s.files.id, want)).all();
    const left = want.filter((id) => !read.has(id) && rows.some((r) => r.id === id));
    (globalThis as unknown as Record<string, string[]>)[WANT] = left;
    const first = left.find((id) => !skip(id));
    if (first) return { projectId: rows.find((r) => r.id === first)!.projectId, fileId: first };
  }
  const projects = db
    .select({ id: s.projects.id, createdAt: s.projects.createdAt })
    .from(s.projects)
    .where(and(eq(s.projects.isDemo, false), inArray(s.projects.status, ["building", "ready"])))
    .all()
    .sort((a, b) => Number(b.id === firstProject) - Number(a.id === firstProject) || b.createdAt - a.createdAt);
  for (const p of projects) {
    const read = new Set(db.select({ id: s.brainReads.fileId }).from(s.brainReads).where(eq(s.brainReads.projectId, p.id)).all().map((r) => r.id));
    const weeks = fileWeeks(db, p.id);
    const names = new Map(db.select({ id: s.files.id, name: s.files.name }).from(s.files).where(eq(s.files.projectId, p.id)).all().map((f) => [f.id, f.name]));
    const unread = [...weeks].filter(([id]) => !read.has(id) && !skip(id)).map(([id, ws]) => ({ id, name: names.get(id) ?? "", weeks: ws }));
    if (!unread.length) continue;
    const order = readingRank(unread, courseCurrentWeek(db, p.id));
    return { projectId: p.id, fileId: order[0] };
  }
  return null;
}
