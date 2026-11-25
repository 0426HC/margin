import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import type { BlockKind } from "@/lib/import/types";
import { blocksForPassages } from "./source-blocks";

/** A stretch of a block's text. `hit` marks the part that is the cited passage. */
export interface ViewPart {
  text: string;
  hit: boolean;
}
export interface ViewBlock {
  kind: BlockKind;
  level?: number;
  parts: ViewPart[];
}
export interface SourcePage {
  file: string;
  page: number;
  pageCount: number;
  pageKind: "page" | "slide" | "virtual";
  blocks: ViewBlock[];
}

const words = (text: string) => text.match(/[\p{L}\p{N}]+/gu)?.map((w) => w.toLowerCase()) ?? [];
const wordsOf = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);
const STOP = new Set(["the", "a", "an", "and", "of", "to", "in", "is", "it", "that", "for", "on", "as", "by", "with", "this", "was", "are", "be"]);

/** Of the passages on one page, the one that shares the most words with what was said about it. With nothing to go on, the first. */
export function bestPassage<T extends { text: string }>(candidates: T[], near?: string): T | undefined {
  if (!near) return candidates[0];
  const said = new Set(words(near).filter((w) => !STOP.has(w)));
  let best = candidates[0];
  let score = -1;
  for (const c of candidates) {
    const n = [...new Set(words(c.text))].filter((w) => said.has(w)).length;
    if (n > score) {
      best = c;
      score = n;
    }
  }
  return best;
}

/** Cut one block's text around the verbatim pieces that make up the cited passage. Text is never altered, only split. */
export function markBlock(text: string, pieces: string[]): ViewPart[] {
  const spans: [number, number][] = [];
  for (const p of pieces) {
    const at = text.indexOf(p);
    if (at >= 0 && p.length) spans.push([at, at + p.length]);
  }
  if (!spans.length) return [{ text, hit: false }];
  spans.sort((a, b) => a[0] - b[0]);
  const parts: ViewPart[] = [];
  let at = 0;
  for (const [from, to] of spans) {
    if (from < at) continue;
    if (from > at) parts.push({ text: text.slice(at, from), hit: false });
    parts.push({ text: text.slice(from, to), hit: true });
    at = to;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return parts;
}

/**
 * One page of a file exactly as it was stored, with the cited passage marked. `near` is the sentence that carried the citation:
 * it only picks which passage on the page to mark. Returns null when the file or page isn't there.
 */
export function getSourcePage(db: Db, projectId: string, fileName: string, page: number, near?: string): SourcePage | null {
  const file = db.select().from(s.files).where(and(eq(s.files.projectId, projectId), eq(s.files.name, fileName))).get();
  if (!file) return null;
  // The sections hold the file's text verbatim with page numbers (the demo keeps no separate parsed copy), in reading order.
  const secs = db.select({ original: s.sections.original }).from(s.sections).where(eq(s.sections.fileId, file.id)).orderBy(asc(s.sections.position)).all();
  const onPage = secs.flatMap((x) => x.original).filter((b) => b.page === page);
  if (!onPage.length) return null;

  const candidates = db.select().from(s.passages).where(and(eq(s.passages.fileId, file.id), eq(s.passages.page, page))).orderBy(asc(s.passages.ordinal)).all();
  const chosen = bestPassage(candidates, near);
  let pieces: string[] = [];
  if (chosen) {
    const section = db.select({ original: s.sections.original }).from(s.sections).where(eq(s.sections.id, chosen.sectionId)).get();
    const all = db.select({ id: s.passages.id, text: s.passages.text }).from(s.passages).where(eq(s.passages.sectionId, chosen.sectionId)).orderBy(asc(s.passages.ordinal)).all();
    if (section) {
      const cut = blocksForPassages(section.original, all.map((p) => wordsOf(p.text)));
      pieces = (cut[all.findIndex((p) => p.id === chosen.id)] ?? []).map((b) => b.text);
    }
  }
  return {
    file: file.name,
    page,
    pageCount: file.pageCount ?? Math.max(...secs.flatMap((x) => x.original.map((b) => b.page))),
    pageKind: file.pageKind ?? "page",
    blocks: onPage.map((b) => ({ kind: b.kind, level: b.level, parts: markBlock(b.text, pieces) })),
  };
}
