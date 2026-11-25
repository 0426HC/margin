/**
 * "Show full reading" on a layer's Source tab: the week's readings and lecture files, and any one of them in full, exactly as stored,
 * with the passages this layer is built from marked. Read by code only; nothing here is written by the AI.
 */
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import type { BlockKind } from "@/lib/import/types";
import { effectiveRole } from "@/lib/updates/classify";
import { wordsOf } from "./reading-order";
import { blocksForPassages } from "./source-blocks";
import { markBlock, type ViewPart } from "./source-view";

export interface ReadingFile {
  id: string;
  name: string;
  /** "Reading" or "Lecture". */
  role: "Reading" | "Lecture";
  /** How many of this layer's passages come from it (0 for a file of the week the layer doesn't draw on). */
  inLayer: number;
}

export interface FullReading {
  fileId: string;
  file: string;
  pageKind: "page" | "slide" | "virtual";
  blocks: { page: number; kind: BlockKind; level?: number; parts: ViewPart[] }[];
  /** Whether any of the layer's passages were found in the text (they always are, unless the file changed). */
  marked: boolean;
}

const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function layerScope(db: Db, layerId: string) {
  const row = db.select({ partId: s.layers.partId }).from(s.layers).where(eq(s.layers.id, layerId)).get();
  if (!row) return null;
  const week = db.select({ projectId: s.parts.projectId, week: s.parts.week }).from(s.parts).where(eq(s.parts.id, row.partId)).get();
  if (!week) return null;
  const mine = db.select({ id: s.layerPassages.passageId, fileId: s.passages.fileId }).from(s.layerPassages).innerJoin(s.passages, eq(s.passages.id, s.layerPassages.passageId)).where(eq(s.layerPassages.layerId, layerId)).all();
  return { ...week, mine };
}

/** The week's course files (readings and lecture notes or slides), and any other file this layer draws on, in folder order. */
export function weekReadings(db: Db, layerId: string): ReadingFile[] | null {
  const scope = layerScope(db, layerId);
  if (!scope) return null;
  const used = new Map<string, number>();
  for (const p of scope.mine) used.set(p.fileId, (used.get(p.fileId) ?? 0) + 1);
  const ofWeek = scope.week === null ? [] : db.select({ id: s.files.id }).from(s.files).where(and(eq(s.files.projectId, scope.projectId), eq(s.files.week, scope.week), eq(s.files.status, "done"), or(isNull(s.files.category), eq(s.files.category, "course")))).all().map((f) => f.id);
  const ids = [...new Set([...ofWeek, ...used.keys()])];
  if (!ids.length) return [];
  // only files that were cut into text: a file that was read but never indexed has nothing to show
  const indexed = new Set(db.selectDistinct({ id: s.sections.fileId }).from(s.sections).where(inArray(s.sections.fileId, ids)).all().map((r) => r.id));
  return db
    .select()
    .from(s.files)
    .where(inArray(s.files.id, ids.filter((id) => indexed.has(id))))
    .all()
    .sort((a, b) => natural.compare(a.relPath, b.relPath))
    .map((f) => ({ id: f.id, name: f.name, role: effectiveRole(f) === "lecture" ? "Lecture" : "Reading", inLayer: used.get(f.id) ?? 0 }));
}

/** One file of the layer's week in full, verbatim, with the layer's own passages marked. Null when the file isn't one of the week's. */
export function fullReading(db: Db, layerId: string, fileId: string): FullReading | null {
  const scope = layerScope(db, layerId);
  const files = weekReadings(db, layerId);
  if (!scope || !files?.some((f) => f.id === fileId)) return null;
  const file = db.select().from(s.files).where(eq(s.files.id, fileId)).get()!;
  const mine = new Set(scope.mine.map((p) => p.id));
  const sections = db.select({ id: s.sections.id, original: s.sections.original }).from(s.sections).where(eq(s.sections.fileId, fileId)).orderBy(asc(s.sections.position)).all();
  let marked = false;
  const blocks = sections.flatMap((sec) => {
    const ps = db.select({ id: s.passages.id, text: s.passages.text }).from(s.passages).where(eq(s.passages.sectionId, sec.id)).orderBy(asc(s.passages.ordinal)).all();
    // the exact stretches of this section's blocks that are the layer's passages
    const cut = blocksForPassages(sec.original, ps.map((p) => wordsOf(p.text)));
    const pieces = ps.flatMap((p, i) => (mine.has(p.id) ? (cut[i] ?? []).map((b) => b.text) : []));
    return sec.original.map((b) => {
      const parts = pieces.length ? markBlock(b.text, pieces) : [{ text: b.text, hit: false }];
      if (parts.some((x) => x.hit)) marked = true;
      return { page: b.page, kind: b.kind, level: b.level, parts };
    });
  });
  return { fileId, file: file.name, pageKind: file.pageKind ?? "page", blocks, marked };
}
