/** The names of a course's weeks: "Week 3 · The Constitution". The topic is the title Claude read from the syllabus at import. */
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { courseWeekRows } from "@/lib/projects/course-import";

/** "Week 3 · The Constitution", or "Week 3" for a week with no topic of its own. */
export function weekName(week: number, title?: string | null): string {
  const t = (title ?? "").trim();
  return t ? `Week ${week} · ${t}` : `Week ${week}`;
}

/** The row key of a week: "W3". */
export const weekKey = (week: number) => `W${week}`;

/** The week topics of one course, as the syllabus words them; for a course imported before Claude read the syllabus, its week units' titles ("Week 3: Congress"). */
export function courseWeekTitles(db: Db, projectId: string): Map<number, string> {
  const out = new Map(courseWeekRows(db, projectId).filter((w) => w.title.trim()).map((w) => [w.week, w.title.trim()]));
  for (const u of db.select({ title: s.units.title }).from(s.units).where(eq(s.units.projectId, projectId)).all()) {
    const m = /^Week (\d+): (.+)$/.exec(u.title);
    if (m && !out.has(Number(m[1]))) out.set(Number(m[1]), m[2].trim());
  }
  return out;
}
