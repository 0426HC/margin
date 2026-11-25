import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { weekOfUnit } from "@/lib/updates/weeks";

/** The highest week any course file is in (its own week, else the week its unit names). 0 when none has one. */
export function topFileWeek(db: Db, projectId: string): number {
  const units = new Map(db.select({ id: s.units.id, title: s.units.title }).from(s.units).where(eq(s.units.projectId, projectId)).all().map((u) => [u.id, u.title]));
  const rows = db.select({ week: s.files.week, unitId: s.files.unitId, category: s.files.category }).from(s.files).where(and(eq(s.files.projectId, projectId), eq(s.files.status, "done"))).all();
  let top = 0;
  for (const r of rows) {
    if (r.category !== "course" && r.category !== "optional" && r.category !== "notes") continue;
    const w = r.week ?? (r.unitId ? weekOfUnit(units.get(r.unitId) ?? "") : null);
    if (w && w > top) top = w;
  }
  return top;
}

/**
 * How many weeks the course has: what the student set, else the last of the weeks Claude read from the syllabus at import, else the
 * highest week in the files. Never a default: null when nothing says, and Margin asks.
 */
export function courseWeekCount(db: Db, projectId: string): number | null {
  const project = db.select({ weekCount: s.projects.weekCount }).from(s.projects).where(eq(s.projects.id, projectId)).get();
  if (project?.weekCount) return project.weekCount;
  const fromSyllabus = db.select({ n: sql<number | null>`max(${s.courseWeeks.week})` }).from(s.courseWeeks).where(eq(s.courseWeeks.projectId, projectId)).get()?.n ?? 0;
  const n = Math.max(fromSyllabus, topFileWeek(db, projectId));
  return n > 0 ? n : null;
}

export const MAX_WEEKS = 60;

/** "This course has __ weeks". Weeks with files or notes beyond the new number keep them; they just sit past the end until moved. */
export function setWeekCount(db: Db, projectId: string, n: number) {
  if (!Number.isInteger(n) || n < 1 || n > MAX_WEEKS) throw new RangeError(`A course has between 1 and ${MAX_WEEKS} weeks.`);
  db.update(s.projects).set({ weekCount: n }).where(eq(s.projects.id, projectId)).run();
}
