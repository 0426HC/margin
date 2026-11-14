import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Engine } from "@/lib/ai/engine";
import { BadStructuredOutput } from "@/lib/ai/errors";
import { pickLayerSource, proposeLayers, proposePartSplit, writeExplained } from "@/lib/ai/tasks";
import type { LayerBreakdown } from "@/lib/ai/schemas";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { copySource } from "./copy-source";
import { blocksForPassages, type QuoteBlock } from "./source-blocks";
import { fallbackBreakdown } from "./fallback";
import { readingOrder, wordsOf } from "./reading-order";
import { defaultSplit, splitAtUnit, summariseUnits } from "./split-parts";
import type { LayerView, OrderedPassage, StructureLayer, StructureModel, StructurePart } from "./types";
import { countStates, type LayerState } from "./progress";
import { layerWarnings, partWarnings, validateBreakdown } from "./validate-breakdown";

/** Something the student can fix: a plain message, shown as is. */
export class StructureError extends Error {}
/** The breakdown isn't approved yet, so no content may be written (HTTP 409). */
export class GateError extends Error {}

const WORDS_PER_MINUTE = 230;
type Key = "A" | "B";

// ---------------------------------------------------------------- reading the structure

function layerRows(db: Db, partId: string) {
  return db.select().from(s.layers).where(eq(s.layers.partId, partId)).orderBy(asc(s.layers.position)).all();
}

function layerPassageList(db: Db, layerId: string, all: Map<string, OrderedPassage>): OrderedPassage[] {
  const rows = db.select().from(s.layerPassages).where(eq(s.layerPassages.layerId, layerId)).orderBy(asc(s.layerPassages.ordinal)).all();
  return rows.map((r) => all.get(r.passageId)).filter((p): p is OrderedPassage => !!p).map((p, i) => ({ ...p, n: i + 1 }));
}

function sourcesOf(passages: OrderedPassage[]) {
  const byFile = new Map<string, { min: number; max: number }>();
  for (const p of passages) {
    const r = byFile.get(p.file);
    byFile.set(p.file, r ? { min: Math.min(r.min, p.page), max: Math.max(r.max, p.page) } : { min: p.page, max: p.page });
  }
  return [...byFile].map(([file, r]) => ({ file, pages: r.min === r.max ? `p. ${r.min}` : `pp. ${r.min}–${r.max}` }));
}

/** Where each layer (or, with type "part", each Part synthesis) stands: saved once something is in Note to Self for it. */
export function targetStates(db: Db, type: "layer" | "part", ids: string[]): Map<string, LayerState> {
  const out = new Map<string, LayerState>(ids.map((id) => [id, "not_saved"]));
  if (!ids.length) return out;
  for (const r of db.select({ id: s.noteSaves.targetId }).from(s.noteSaves).where(and(eq(s.noteSaves.targetType, type), inArray(s.noteSaves.targetId, ids))).all()) out.set(r.id, "saved");
  return out;
}
const layerStates = (db: Db, layerIds: string[]) => targetStates(db, "layer", layerIds);

/** A plain line about a Part, built from its big questions. No AI involved. */
function aboutPart(title: string, questions: string[]): string {
  if (!questions.length) return "";
  const quote = (q: string) => `\u201c${q.trim()}\u201d`;
  if (questions.length === 1) return `${title} is one layer. It asks ${quote(questions[0])}`;
  return `${title} is ${questions.length} layers. It begins with ${quote(questions[0])} and builds, layer by layer, to ${quote(questions[questions.length - 1])}`;
}

export function getStructure(db: Db, projectId: string): StructureModel | null {
  const project = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get();
  if (!project) return null;
  const all = new Map(readingOrder(db, projectId).map((p) => [p.passageId, p]));
  const partRows = db.select().from(s.parts).where(eq(s.parts.projectId, projectId)).orderBy(asc(s.parts.key)).all();
  const states = layerStates(db, partRows.flatMap((p) => layerRows(db, p.id).map((l) => l.id)));
  const synthStates = targetStates(db, "part", partRows.map((p) => p.id));
  const parts: StructurePart[] = db
    .select()
    .from(s.parts)
    .where(eq(s.parts.projectId, projectId))
    .orderBy(asc(s.parts.key))
    .all()
    .map((part) => {
      const layers: StructureLayer[] = layerRows(db, part.id).map((l) => {
        const ps = layerPassageList(db, l.id, all);
        const words = ps.reduce((n, p) => n + p.words, 0);
        return {
          id: l.id,
          position: l.position,
          title: l.title,
          bigQuestion: l.bigQuestion,
          buildsOn: l.buildsOn,
          words,
          minutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
          passages: ps.length,
          contentStatus: l.contentStatus,
          state: states.get(l.id) ?? "not_saved",
          sources: sourcesOf(ps),
          warnings: layerWarnings(words),
        };
      });
      const units = [...new Set(layerRows(db, part.id).flatMap((l) => layerPassageList(db, l.id, all).map((p) => p.unit)))];
      return {
        id: part.id,
        key: part.key,
        title: part.title,
        status: part.breakdownStatus,
        span: units.length <= 1 ? (units[0] ?? "") : `${units[0]} to ${units[units.length - 1]}`,
        words: layers.reduce((n, l) => n + l.words, 0),
        layers,
        warnings: partWarnings(layers.length),
        progress: countStates(layers.map((l) => l.state)),
        synthesis: synthStates.get(part.id) ?? "not_saved",
        about: aboutPart(part.title, layers.map((l) => l.bigQuestion)),
      };
    });
  const resume = parts.flatMap((p) => p.layers).find((l) => l.state !== "saved");
  return {
    project: { id: project.id, name: project.name, courseCode: project.courseCode, status: project.status, isDemo: project.isDemo },
    parts,
    resume: resume ? { layerId: resume.id, title: resume.title } : null,
    note: (db.select({ v: s.uiState.value }).from(s.uiState).where(and(eq(s.uiState.projectId, projectId), eq(s.uiState.key, "structure-note"))).get()?.v as string | undefined) ?? null,
  };
}

// ---------------------------------------------------------------- proposing

/** The AI's proposal for one Part, checked by code. `fallback` is set when it was invalid twice and a plain split by unit was used instead. */
async function breakdownFor(engine: Engine, part: Key, passages: OrderedPassage[], previousPartLayers: string[] | undefined, signal?: AbortSignal): Promise<{ breakdown: LayerBreakdown; fallback: boolean; reasons?: string }> {
  const numbered = passages.map((p, i) => ({ n: i + 1, unit: p.unit, file: p.file, page: p.page, text: p.text }));
  let feedback: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const proposal = await proposeLayers(engine, { part, passages: numbered, previousPartLayers, feedback }, signal);
      const { errors } = validateBreakdown(proposal.layers, passages.length);
      if (!errors.length) return { breakdown: proposal, fallback: false };
      feedback = errors.slice(0, 6).join(" ");
    } catch (e) {
      if (!(e instanceof BadStructuredOutput)) throw e; // a missing or logged-out claude is not an invalid answer
      feedback = "It did not match the required JSON shape.";
    }
  }
  return { breakdown: fallbackBreakdown(passages.map((p, i) => ({ ...p, n: i + 1 }))), fallback: true, reasons: feedback }; // numbered within this Part, like the ranges
}

/**
 * Propose the Part split and the layers of each Part. The AI proposes, code checks: every passage must land in exactly one layer.
 * Nothing is written to the layers' content here; the student approves the breakdown first.
 */
export async function proposeStructure(db: Db, engine: Engine, projectId: string, signal?: AbortSignal) {
  const passages = readingOrder(db, projectId);
  if (passages.length < 2) throw new StructureError("There isn't enough text to split into two Parts yet. Add more files to the project first.");
  const approved = db.select().from(s.parts).where(and(eq(s.parts.projectId, projectId), eq(s.parts.breakdownStatus, "approved"))).all();
  if (approved.length) throw new GateError("This breakdown is already approved. Edit its layers instead of proposing it again.");

  const units = summariseUnits(passages);
  let split = defaultSplit(passages);
  if (units.length >= 2) {
    try {
      const ai = await proposePartSplit(engine, units.map((u) => ({ n: u.n, title: u.title, words: u.words })), signal);
      split = splitAtUnit(passages, ai.firstUnitOfPartB) ?? split; // an impossible unit number falls back to the middle
    } catch (e) {
      if (!(e instanceof BadStructuredOutput)) throw e;
    }
  }
  const partA = passages.slice(0, split);
  const partB = passages.slice(split);
  const ra = await breakdownFor(engine, "A", partA, undefined, signal);
  const rb = await breakdownFor(engine, "B", partB, ra.breakdown.layers.map((l) => l.title), signal);
  const a = ra.breakdown;
  const b = rb.breakdown;
  const fellBack = ([["A", ra], ["B", rb]] as const).filter(([, r]) => r.fallback).map(([k]) => k);

  db.transaction((tx) => {
    tx.delete(s.parts).where(eq(s.parts.projectId, projectId)).run(); // cascades to layers and their passages
    for (const [key, slice, proposal] of [["A", partA, a], ["B", partB, b]] as const) {
      const partId = nanoid(10);
      tx.insert(s.parts).values({ id: partId, projectId, key, title: `Part ${key}` }).run();
      proposal.layers.forEach((l, position) => {
        const layerId = nanoid(10);
        tx.insert(s.layers).values({ id: layerId, partId, position, title: l.title.trim(), bigQuestion: l.bigQuestion.trim(), buildsOn: l.buildsOn.trim() }).run();
        let ordinal = 0;
        // a layer's own passages stay in reading order, whatever order its ranges were given in
        for (const r of [...l.ranges].sort((x, y) => x.from - y.from)) for (let n = r.from; n <= r.to; n++) tx.insert(s.layerPassages).values({ layerId, passageId: slice[n - 1].passageId, ordinal: ordinal++ }).run();
      });
    }
    tx.update(s.projects).set({ status: "building" }).where(eq(s.projects.id, projectId)).run();
    tx.delete(s.uiState).where(and(eq(s.uiState.projectId, projectId), eq(s.uiState.key, "structure-note"))).run();
    if (fellBack.length)
      tx.insert(s.uiState).values({ id: `${projectId}:structure-note`, projectId, key: "structure-note", value: `Margin couldn't get a valid plan for ${fellBack.map((k) => `Part ${k}`).join(" and ")} from Claude, so ${fellBack.length > 1 ? "they were" : "it was"} split by unit instead. Rename, merge or split the layers below, or suggest the layers again.` }).run();
  });
}

// ---------------------------------------------------------------- editing

function loadLayer(db: Db, layerId: string) {
  const layer = db.select().from(s.layers).where(eq(s.layers.id, layerId)).get();
  if (!layer) throw new StructureError("That layer no longer exists. Reload the page.");
  const part = db.select().from(s.parts).where(eq(s.parts.id, layer.partId)).get()!;
  return { layer, part };
}

const staleIfWritten = (db: Db, layerId: string) =>
  db.update(s.layers).set({ contentStatus: "stale" }).where(and(eq(s.layers.id, layerId), eq(s.layers.contentStatus, "ready"))).run();

/** Rename a layer, change its big question or how it builds on the last one. A changed question makes written content stale. */
export function updateLayer(db: Db, layerId: string, patch: { title?: string; bigQuestion?: string; buildsOn?: string }) {
  const { layer } = loadLayer(db, layerId);
  const next = { title: patch.title?.trim() ?? layer.title, bigQuestion: patch.bigQuestion?.trim() ?? layer.bigQuestion, buildsOn: patch.buildsOn?.trim() ?? layer.buildsOn };
  if (!next.title || !next.bigQuestion) throw new StructureError("A layer needs a title and a big question.");
  db.update(s.layers).set(next).where(eq(s.layers.id, layerId)).run();
  if (next.bigQuestion !== layer.bigQuestion) staleIfWritten(db, layerId);
}

/** Merge a layer with the next one in its Part. The first layer's title and question are kept; written content becomes stale. */
export function mergeWithNext(db: Db, layerId: string) {
  db.transaction((tx) => {
    const { layer } = loadLayer(tx, layerId);
    const next = layerRows(tx, layer.partId).find((l) => l.position > layer.position);
    if (!next) throw new StructureError("This is the last layer in its Part, so there is nothing to merge it with.");
    const keep = tx.select().from(s.layerPassages).where(eq(s.layerPassages.layerId, layer.id)).all().length;
    const moved = tx.select().from(s.layerPassages).where(eq(s.layerPassages.layerId, next.id)).orderBy(asc(s.layerPassages.ordinal)).all();
    moved.forEach((r, i) => tx.update(s.layerPassages).set({ layerId: layer.id, ordinal: keep + i }).where(eq(s.layerPassages.passageId, r.passageId)).run());
    tx.delete(s.layers).where(eq(s.layers.id, next.id)).run();
    closeGaps(tx, layer.partId);
    staleIfWritten(tx, layer.id);
  });
}

/** Split a layer in two, near the middle by word count. Both halves keep the title (the second says "continued") for the student to rename. */
export function splitLayer(db: Db, layerId: string) {
  db.transaction((tx) => {
    const { layer } = loadLayer(tx, layerId);
    const all = new Map(readingOrder(tx, tx.select({ p: s.parts.projectId }).from(s.parts).where(eq(s.parts.id, layer.partId)).get()!.p).map((p) => [p.passageId, p]));
    const ps = layerPassageList(tx, layer.id, all);
    if (ps.length < 2) throw new StructureError("This layer is a single passage, so it can't be split.");
    const total = ps.reduce((n, p) => n + p.words, 0);
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < ps.length - 1; i++) {
      acc += ps[i].words;
      cut = i + 1;
      if (acc >= total / 2) break;
    }
    tx.update(s.layers).set({ position: sql`${s.layers.position} + 1` }).where(and(eq(s.layers.partId, layer.partId), sql`${s.layers.position} > ${layer.position}`)).run();
    const newId = nanoid(10);
    tx.insert(s.layers).values({ id: newId, partId: layer.partId, position: layer.position + 1, title: `${layer.title} (continued)`.slice(0, 80), bigQuestion: layer.bigQuestion, buildsOn: `Follows ${layer.title}.` }).run();
    ps.slice(cut).forEach((p, i) => tx.update(s.layerPassages).set({ layerId: newId, ordinal: i }).where(eq(s.layerPassages.passageId, p.passageId)).run());
    staleIfWritten(tx, layer.id);
  });
}

function closeGaps(db: Db, partId: string) {
  layerRows(db, partId).forEach((l, i) => db.update(s.layers).set({ position: i }).where(eq(s.layers.id, l.id)).run());
}

/**
 * Move a layer up or down. At the edge of Part A or Part B it crosses into the other Part, which is also how the split
 * between the Parts is moved. A Part always keeps at least one layer.
 */
export function moveLayer(db: Db, layerId: string, direction: "up" | "down") {
  db.transaction((tx) => {
    const { layer, part } = loadLayer(tx, layerId);
    const rows = layerRows(tx, part.id);
    const i = rows.findIndex((r) => r.id === layer.id);
    const swap = rows[direction === "up" ? i - 1 : i + 1];
    if (swap) {
      tx.update(s.layers).set({ position: swap.position }).where(eq(s.layers.id, layer.id)).run();
      tx.update(s.layers).set({ position: layer.position }).where(eq(s.layers.id, swap.id)).run();
      return;
    }
    const otherKey: Key | null = direction === "down" && part.key === "A" ? "B" : direction === "up" && part.key === "B" ? "A" : null;
    if (!otherKey) throw new StructureError(direction === "up" ? "This is the first layer of the course." : "This is the last layer of the course.");
    if (rows.length < 2) throw new StructureError(`Part ${part.key} would be left with no layers. Add one to it first, or merge layers instead.`);
    const other = tx.select().from(s.parts).where(and(eq(s.parts.projectId, part.projectId), eq(s.parts.key, otherKey))).get()!;
    if (otherKey === "B") {
      tx.update(s.layers).set({ position: sql`${s.layers.position} + 1` }).where(eq(s.layers.partId, other.id)).run();
      tx.update(s.layers).set({ partId: other.id, position: 0 }).where(eq(s.layers.id, layer.id)).run();
    } else {
      tx.update(s.layers).set({ partId: other.id, position: layerRows(tx, other.id).length }).where(eq(s.layers.id, layer.id)).run();
    }
    closeGaps(tx, part.id);
  });
}

/** Approve a Part's breakdown. Only now may its layers' content be written. */
export function approvePart(db: Db, projectId: string, key: Key) {
  db.transaction((tx) => {
    const part = tx.select().from(s.parts).where(and(eq(s.parts.projectId, projectId), eq(s.parts.key, key))).get();
    if (!part) throw new StructureError("Propose the layers first.");
    if (!layerRows(tx, part.id).length) throw new StructureError(`Part ${key} has no layers.`);
    const total = tx.select({ n: sql<number>`count(*)` }).from(s.passages).where(eq(s.passages.projectId, projectId)).get()!.n;
    const used = tx.select({ n: sql<number>`count(*)` }).from(s.layerPassages).innerJoin(s.layers, eq(s.layers.id, s.layerPassages.layerId)).innerJoin(s.parts, eq(s.parts.id, s.layers.partId)).where(eq(s.parts.projectId, projectId)).get()!.n;
    if (used !== total) throw new StructureError("Some of the text isn't in any layer. Propose the layers again.");
    tx.update(s.parts).set({ breakdownStatus: "approved", approvedAt: Date.now() }).where(eq(s.parts.id, part.id)).run();
    const parts = tx.select().from(s.parts).where(eq(s.parts.projectId, projectId)).all();
    if (parts.length === 2 && parts.every((p) => p.breakdownStatus === "approved")) tx.update(s.projects).set({ status: "ready" }).where(eq(s.projects.id, projectId)).run();
  });
}

// ---------------------------------------------------------------- writing a layer

export function getLayer(db: Db, layerId: string): LayerView | null {
  const layer = db.select().from(s.layers).where(eq(s.layers.id, layerId)).get();
  if (!layer) return null;
  const part = db.select().from(s.parts).where(eq(s.parts.id, layer.partId)).get()!;
  const rows = layerRows(db, part.id);
  const i = rows.findIndex((r) => r.id === layer.id);
  const pick = (r?: { id: string; title: string }) => (r ? { id: r.id, title: r.title } : null);
  const content = db.select().from(s.layerContent).where(eq(s.layerContent.layerId, layerId)).get();
  return {
    id: layer.id,
    projectId: part.projectId,
    title: layer.title,
    bigQuestion: layer.bigQuestion,
    contentStatus: layer.contentStatus,
    part: { key: part.key, status: part.breakdownStatus },
    previous: pick(rows[i - 1]),
    next: pick(rows[i + 1]),
    content: content ? { explained: content.explained, source: content.source, writtenAt: content.writtenAt } : null,
  };
}

/** The original blocks behind each passage, so the Source tab keeps paragraphs, headings and lists. */
function quoteBlocks(db: Db, passageIds: string[]): Map<string, QuoteBlock[]> {
  const wanted = new Set(passageIds);
  const sectionIds = new Set(db.select({ sectionId: s.passages.sectionId }).from(s.passages).where(inArray(s.passages.id, passageIds)).all().map((r) => r.sectionId));
  const out = new Map<string, QuoteBlock[]>();
  for (const sectionId of sectionIds) {
    const section = db.select({ original: s.sections.original }).from(s.sections).where(eq(s.sections.id, sectionId)).get();
    const ps = db.select({ id: s.passages.id, text: s.passages.text }).from(s.passages).where(eq(s.passages.sectionId, sectionId)).orderBy(asc(s.passages.ordinal)).all();
    if (!section) continue;
    const blocks = blocksForPassages(section.original, ps.map((p) => wordsOf(p.text)));
    ps.forEach((p, i) => wanted.has(p.id) && out.set(p.id, blocks[i]));
  }
  return out;
}

const inflight = new Map<string, Promise<void>>();

/**
 * Write a layer's Source and Explained tabs, once, then cache them. The breakdown must be approved first (GateError, no engine call).
 * The AI picks which of the layer's passages the explanation rests on; code copies their exact text; then the explanation is written from those.
 */
export function writeLayerContent(db: Db, engine: Engine, layerId: string, signal?: AbortSignal): Promise<void> {
  const { layer, part } = loadLayer(db, layerId);
  if (part.breakdownStatus !== "approved") throw new GateError("Approve this Part's layers first. Nothing is written until you do.");
  if (layer.contentStatus === "ready") return Promise.resolve();
  const running = inflight.get(layerId);
  if (running) return running;

  const job = (async () => {
    const before = layer.contentStatus;
    db.update(s.layers).set({ contentStatus: "writing" }).where(eq(s.layers.id, layerId)).run();
    try {
      const all = new Map(readingOrder(db, part.projectId).map((p) => [p.passageId, p]));
      const passages = layerPassageList(db, layerId, all);
      const rows = layerRows(db, part.id);
      const i = rows.findIndex((r) => r.id === layerId);
      const ref = (r?: { title: string; bigQuestion: string }) => (r ? { title: r.title, bigQuestion: r.bigQuestion } : undefined);
      const pick = await pickLayerSource(engine, { layer: { title: layer.title, bigQuestion: layer.bigQuestion }, passages: passages.map((p) => ({ n: p.n, file: p.file, page: p.page, text: p.text })) }, signal);
      const source = copySource(pick.passages, passages, quoteBlocks(db, passages.map((p) => p.passageId)));
      const { explained } = await writeExplained(engine, { layer: { title: layer.title, bigQuestion: layer.bigQuestion }, passages: source, previous: ref(rows[i - 1]), next: ref(rows[i + 1]) }, signal);
      db.transaction((tx) => {
        tx.delete(s.layerContent).where(eq(s.layerContent.layerId, layerId)).run();
        tx.insert(s.layerContent).values({ id: nanoid(10), layerId, explained, source }).run();
        tx.update(s.layers).set({ contentStatus: "ready" }).where(eq(s.layers.id, layerId)).run();
      });
    } catch (e) {
      db.update(s.layers).set({ contentStatus: before === "writing" ? "none" : before }).where(eq(s.layers.id, layerId)).run();
      throw e;
    }
  })().finally(() => inflight.delete(layerId));
  inflight.set(layerId, job);
  return job;
}


/** The layer's own passages in reading order, numbered from 1. Used to ground reviews and re-explanations. */
export function passagesOfLayer(db: Db, layerId: string): OrderedPassage[] {
  const { part } = loadLayer(db, layerId);
  return layerPassageList(db, layerId, new Map(readingOrder(db, part.projectId).map((p) => [p.passageId, p])));
}

export { loadLayer, layerRows };
