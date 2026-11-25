/**
 * One file, different pages in different weeks. A syllabus may assign pp. 7-30 of a chapter to Week 2 and pp. 31-45 to Week 3, and the
 * student saves the chapter in both week folders. Margin stores and reads the file once (exact copies are set aside at import), and the
 * organizer gives each week its page range (`lib/ai/prompts/organize.ts`, PAGE_RANGES). This file stores those ranges, says which week a
 * page belongs to. Courses imported before the rule are checked once in the background (`page-ranges-check.ts`).
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import type { PageRange } from "@/lib/import/organize";

type FileRow = typeof s.files.$inferSelect;
type StoredRange = typeof s.filePages.$inferSelect;

/** "Week 2: pp. 7–30 · Week 3: pp. 31–45". */
export const rangesLine = (pages: PageRange[]) => [...pages].sort((a, b) => a.week - b.week || a.from - b.from).map((r) => `Week ${r.week}: ${r.from === r.to ? `p. ${r.from}` : `pp. ${r.from}–${r.to}`}`).join(" · ");

/** Why an exact copy is set aside: it is used once, and when the syllabus splits its pages, each week gets its own. */
export const copyReason = (pages: PageRange[]) =>
  pages.length ? `The same file as another in the folder, so it is stored and read once; the syllabus splits its pages between weeks (${rangesLine(pages)}).` : "The same file as another in the folder, so it is used once.";

/**
 * Store the weeks' page ranges of one file, in its own page numbers as well as the syllabus's. Only course material, and only when the
 * syllabus gives pages to two or more weeks; a range wholly outside the file is dropped, one partly outside is cut to the file.
 */
export function savePageRanges(db: Db, projectId: string, f: Pick<FileRow, "id" | "pageCount" | "pageOffset" | "category">, pages: PageRange[]) {
  db.delete(s.filePages).where(eq(s.filePages.fileId, f.id)).run();
  if (f.category !== "course" || new Set(pages.map((p) => p.week)).size < 2) return;
  const offset = f.pageOffset ?? 0;
  const last = Math.max(1, f.pageCount ?? 1);
  for (const r of pages) {
    const pageFrom = Math.max(1, r.from - offset);
    const pageTo = Math.min(last, r.to - offset);
    if (pageTo < pageFrom) continue;
    db.insert(s.filePages).values({ projectId, fileId: f.id, week: r.week, printedFrom: r.from, printedTo: r.to, pageFrom, pageTo }).run();
  }
}

/** The week a page of a split file belongs to: the range that holds it (the narrowest when two weeks both claim it, the earlier week on a tie), else null. Pure. */
export function weekOfPage(ranges: Pick<StoredRange, "week" | "pageFrom" | "pageTo">[], page: number): number | null {
  const holding = ranges.filter((r) => page >= r.pageFrom && page <= r.pageTo).sort((a, b) => a.pageTo - a.pageFrom - (b.pageTo - b.pageFrom) || a.week - b.week);
  return holding[0]?.week ?? null;
}

/** Every split file's ranges, by file id. */
export function pageRangesByFile(db: Db, projectId: string): Map<string, StoredRange[]> {
  const out = new Map<string, StoredRange[]>();
  for (const r of db.select().from(s.filePages).where(eq(s.filePages.projectId, projectId)).all()) out.set(r.fileId, [...(out.get(r.fileId) ?? []), r]);
  return out;
}

/** The weeks each split file's pages go to, by file id. */
export function pageRangeWeeks(db: Db, projectId: string): Map<string, number[]> {
  return new Map([...pageRangesByFile(db, projectId)].map(([id, rs]) => [id, [...new Set(rs.map((r) => r.week))]]));
}
