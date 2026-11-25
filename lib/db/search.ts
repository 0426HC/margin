import { sql } from "drizzle-orm";
import type { Db } from "./client";

export interface PassageHit {
  passageId: string;
  sectionId: string;
  file: string;
  page: number;
  text: string;
  /** BM25 rank: lower is better. */
  score: number;
}

/** Words every passage has: searching for them finds everything, so they are left out of a query that has other words. */
const STOP = new Set("a an and are as at be but by did do does for from had has have how i in is it its me my of on or so than that the their them then there these they this to was we were what when where which who why will with you your about into".split(" "));

/** Turn free text into a safe FTS5 query: quoted words joined with OR, common words left out. Punctuation and operators are dropped. */
export function toFtsQuery(input: string): string | null {
  const words = [...new Set((input.match(/[\p{L}\p{N}]+/gu) ?? []).map((w) => w.toLowerCase()))];
  const kept = words.filter((w) => !STOP.has(w));
  const use = kept.length ? kept : words;
  return use.length ? use.map((w) => `"${w}"`).join(" OR ") : null;
}

/** BM25 search over a project's passages. Every hit carries its file and page, for citations. */
export function searchPassages(db: Db, projectId: string, query: string, k = 8, scope: { sectionId?: string; unitId?: string; passageIds?: string[]; fileIds?: string[]; notFileIds?: string[] } = {}): PassageHit[] {
  const match = toFtsQuery(query);
  if (!match) return [];
  return db.all<PassageHit>(sql`
    select p.id as passageId, p.section_id as sectionId, f.name as file, p.page as page, p.text as text, bm25(passages_fts) as score
    from passages_fts
    join passages p on p.rowid = passages_fts.rowid
    join files f on f.id = p.file_id
    where passages_fts match ${match}
      and p.project_id = ${projectId}
      ${scope.sectionId ? sql`and p.section_id = ${scope.sectionId}` : sql``}
      ${scope.unitId ? sql`and p.section_id in (select id from sections where unit_id = ${scope.unitId})` : sql``}
      ${scope.fileIds ? (scope.fileIds.length ? sql`and p.file_id in (${sql.join(scope.fileIds.map((i) => sql`${i}`), sql`, `)})` : sql`and 1 = 0`) : sql``}
      ${scope.notFileIds?.length ? sql`and p.file_id not in (${sql.join(scope.notFileIds.map((i) => sql`${i}`), sql`, `)})` : sql``}
      ${scope.passageIds ? (scope.passageIds.length ? sql`and p.id in (${sql.join(scope.passageIds.map((i) => sql`${i}`), sql`, `)})` : sql`and 1 = 0`) : sql``}
    order by bm25(passages_fts)
    limit ${k}
  `);
}
