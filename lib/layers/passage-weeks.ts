import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { pageRangesByFile, weekOfPage } from "@/lib/projects/page-ranges";
import { weekOfUnit } from "@/lib/updates/weeks";

/**
 * The week of every passage: for a file whose pages the syllabus splits between weeks, the week whose range holds the passage's page
 * (`lib/projects/page-ranges.ts`); otherwise, and for pages no week is given, the week the student (or Margin) gave the file, else the
 * week its unit is named for ("Week 3: …"). Passages from files with neither have no week. The same rule as the course's weeks (getCourseWeeks).
 */
export function passageWeeks(db: Db, projectId: string): Map<string, number> {
  const units = new Map(db.select({ id: s.units.id, title: s.units.title }).from(s.units).where(eq(s.units.projectId, projectId)).all().map((u) => [u.id, u.title]));
  const split = pageRangesByFile(db, projectId);
  const rows = db
    .select({ id: s.passages.id, fileId: s.passages.fileId, page: s.passages.page, week: s.files.week, unitId: s.files.unitId })
    .from(s.passages)
    .innerJoin(s.files, eq(s.files.id, s.passages.fileId))
    .where(eq(s.passages.projectId, projectId))
    .all();
  const out = new Map<string, number>();
  for (const r of rows) {
    const ranges = split.get(r.fileId);
    const w = (ranges ? weekOfPage(ranges, r.page) : null) ?? r.week ?? (r.unitId ? weekOfUnit(units.get(r.unitId) ?? "") : null);
    if (w) out.set(r.id, w);
  }
  return out;
}
