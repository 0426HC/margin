import { and, asc, eq, inArray } from "drizzle-orm";
import { formatFacts } from "@/lib/ai/prompts";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import type { Block } from "@/lib/import/types";
import { readingOrder } from "@/lib/layers/reading-order";
import { targetStates } from "@/lib/layers/service";
import { lectureFacts } from "@/lib/lecture/facts";
import { slidesOf } from "@/lib/lecture/sources";
import { effectiveRole } from "@/lib/updates/classify";
import { weekOfUnit } from "@/lib/updates/weeks";
import type { ExamSource, ExamSummary } from "./types";

const PAGE_CHARS = 1800;
const MAX_SHEET_PAGES = 12;
const MAX_READING = 45;
const MAX_LECTURE = 20;

/** A stored file's text by page (a sheet or an uploaded exam): its blocks joined, one entry per page, cut to a sensible length. */
export function pagesOfFile(file: { name: string; parsed: Block[] | null }, kind: "sheet" | "past"): ExamSource[] {
  const byPage = new Map<number, string[]>();
  for (const b of file.parsed ?? []) byPage.set(b.page, [...(byPage.get(b.page) ?? []), b.text]);
  return [...byPage].sort((a, b) => a[0] - b[0]).slice(0, MAX_SHEET_PAGES).map(([page, texts]) => ({ kind, file: file.name, page, text: texts.join("\n").slice(0, PAGE_CHARS) }));
}

/**
 * Layers the student is weaker on: nothing saved to Note to Self yet, or the latest review said "needs work". Used to lean a new set toward them.
 * Returns each layer with the reason, weakest first.
 */
export function weakLayers(db: Db, projectId: string): { id: string; title: string; reason: string }[] {
  const layers = db.select({ id: s.layers.id, title: s.layers.title }).from(s.layers).innerJoin(s.parts, eq(s.parts.id, s.layers.partId)).where(and(eq(s.parts.projectId, projectId), eq(s.layers.proposed, false))).orderBy(asc(s.parts.position), asc(s.parts.key), asc(s.layers.position)).all();
  if (!layers.length) return [];
  const ids = layers.map((l) => l.id);
  const saved = targetStates(db, "layer", ids);
  const latest = new Map<string, "approved" | "needs_work" | null>();
  for (const w of db.select({ target: s.writebacks.targetId, review: s.writebacks.review }).from(s.writebacks).where(and(eq(s.writebacks.targetType, "layer"), inArray(s.writebacks.targetId, ids))).orderBy(asc(s.writebacks.createdAt)).all()) latest.set(w.target, w.review?.verdict ?? null);
  const out: { id: string; title: string; reason: string; rank: number }[] = [];
  for (const l of layers) {
    if (saved.get(l.id) !== "saved") out.push({ id: l.id, title: l.title, reason: latest.has(l.id) ? "written but not saved" : "no write-up saved", rank: latest.has(l.id) ? 1 : 0 });
    else if (latest.get(l.id) === "needs_work") out.push({ id: l.id, title: l.title, reason: "the last review asked for more", rank: 2 });
  }
  return out.sort((a, b) => a.rank - b.rank).map((x) => ({ id: x.id, title: x.title, reason: x.reason }));
}

export interface GatheredSources {
  sources: ExamSource[];
  /** What the lectures in the covered weeks stressed, counted by the Lecture tab's code. Empty when there are no lecture files there. */
  stressed: string;
  /** The weaker layers, as lines for the prompt. */
  weaker: string[];
}

/**
 * Everything a set may be built from, and nothing else: the exam sheet, uploaded past or practice exams, what the lectures stressed (the
 * Lecture tab's counting), and passages of the covered weeks, those from weaker layers first and anything cited by an earlier set last.
 */
export function gatherSources(db: Db, exam: typeof s.exams.$inferSelect, summary: ExamSummary, usedBefore: Set<string>): GatheredSources {
  const files = db.select().from(s.files).where(eq(s.files.projectId, exam.projectId)).all();
  const sources: ExamSource[] = [];
  const sheet = files.find((f) => f.id === exam.sheetFileId);
  if (sheet) sources.push(...pagesOfFile(sheet, "sheet"));
  const materialIds = new Set(db.select({ f: s.examMaterials.fileId }).from(s.examMaterials).where(eq(s.examMaterials.examId, exam.id)).all().map((r) => r.f));
  for (const f of files.filter((x) => materialIds.has(x.id))) sources.push(...pagesOfFile(f, "past"));

  const unitTitle = new Map(db.select({ id: s.units.id, title: s.units.title }).from(s.units).where(eq(s.units.projectId, exam.projectId)).all().map((u) => [u.id, u.title]));
  const fileInfo = new Map(files.map((f) => [f.id, { week: f.week ?? (f.unitId ? weekOfUnit(unitTitle.get(f.unitId) ?? "") : null), role: effectiveRole(f) }]));
  const covered = new Set(summary.weeks);
  const inCovered = (fileId: string) => {
    const i = fileInfo.get(fileId);
    return !!i && i.role !== "exam" && (covered.size === 0 || (i.week !== null && covered.has(i.week)));
  };

  const weak = weakLayers(db, exam.projectId);
  const weakRank = new Map<string, number>();
  weak.forEach((w, i) => {
    for (const r of db.select({ p: s.layerPassages.passageId }).from(s.layerPassages).where(eq(s.layerPassages.layerId, w.id)).all()) weakRank.set(r.p, i);
  });

  const all = readingOrder(db, exam.projectId);
  const fileOfPassage = new Map(db.select({ id: s.passages.id, fileId: s.passages.fileId }).from(s.passages).where(eq(s.passages.projectId, exam.projectId)).all().map((p) => [p.id, p.fileId]));
  const rows = all.flatMap((p) => {
    const fileId = fileOfPassage.get(p.passageId);
    return fileId && inCovered(fileId) ? [{ p, fileId, role: fileInfo.get(fileId)!.role }] : [];
  });
  // weaker layers first, earlier-used pages last; otherwise reading order
  const score = (r: (typeof rows)[number]) => (usedBefore.has(`${r.p.file}\u0000${r.p.page}`) ? 2000 : 0) + (weakRank.has(r.p.passageId) ? weakRank.get(r.p.passageId)! : 1000);
  const ranked = [...rows].sort((a, b) => score(a) - score(b) || a.p.n - b.p.n);
  const take = (role: "lecture" | "reading", n: number) => ranked.filter((r) => r.role === role).slice(0, n);
  for (const r of take("reading", MAX_READING)) sources.push({ kind: "reading", file: r.p.file, page: r.p.page, text: r.p.text });
  for (const r of take("lecture", MAX_LECTURE)) sources.push({ kind: "lecture", file: r.p.file, page: r.p.page, text: r.p.text });

  const allLecture = rows.filter((r) => r.role === "lecture").map((r) => ({ file: r.p.file, fileId: r.fileId, page: r.p.page, text: r.p.text }));
  const slides = allLecture.length ? slidesOf(db, allLecture) : [];
  return { sources, stressed: slides.length ? formatFacts(lectureFacts(slides)) : "", weaker: weak.slice(0, 6).map((w) => `${w.title} (${w.reason})`) };
}
