import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Engine } from "@/lib/ai/engine";
import { createHash } from "node:crypto";
import { BadStructuredOutput, EngineError, EngineTimeout } from "@/lib/ai/errors";
import { isExplainedV2, type ExplainedV2 } from "@/lib/ai/schemas";
import { explainMissingConcepts, pickLayerSource, proposeWeekLayers, writeExplained } from "@/lib/ai/tasks";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { courseWeekRows } from "@/lib/projects/course-import";
import { courseWeekCount } from "@/lib/weeks/count";
import { currentWeek } from "@/lib/weeks/current";
import { copySource } from "./copy-source";
import { explainedBudget } from "./explained-length";
import { layerConcepts } from "@/lib/brain/ask";
import { wantBrainFiles } from "@/lib/brain/queue";
import { cleanExplained, requiredNotes, unexplained } from "./explained-check";
import { finishProgress, lastActivity, setStep, setText, spanWords, startProgress, touch } from "./layer-progress";
import { requeue } from "@/lib/ai/queue";
import { duplicatePairs, duplicateReasons } from "./duplicates";
import { migratePartsToWeeks } from "./migrate-weeks";
import { passageWeeks } from "./passage-weeks";
import { countStates, type LayerState } from "./progress";
import { courseOrder, readingOrder, wordsOf } from "./reading-order";
import { blocksForPassages, type QuoteBlock } from "./source-blocks";
import type { LayerView, OptionalQuote, OrderedPassage, StructureLayer, StructureModel, StructureWeek } from "./types";
import { validateBreakdown } from "./validate-breakdown";
import { tokens } from "./tokens";
import { courseWeekTitles, weekKey, weekName } from "./week-names";
import { opinionPart, shapeWeek, splitByParts, TWO_LAYERS_FROM, type ShapeLayer, type ShapePassage } from "./week-shape";
import { weekSet } from "./weeks";

/** Something the student can fix: a plain message, shown as is. */
export class StructureError extends Error {}
/** The plan isn't approved yet, so no content may be written (HTTP 409). */
export class GateError extends Error {}

const WORDS_PER_MINUTE = 230;

// ---------------------------------------------------------------- reading the structure

/** A week's layers in order. A layer proposed after files were added is not part of the course until it is approved, so it is left out. */
function layerRows(db: Db, partId: string) {
  return db.select().from(s.layers).where(and(eq(s.layers.partId, partId), eq(s.layers.proposed, false))).orderBy(asc(s.layers.position)).all();
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

/** Where each layer (or, with type "part", each week synthesis) stands: saved once something is in Note to Self for it. */
export function targetStates(db: Db, type: "layer" | "part", ids: string[]): Map<string, LayerState> {
  const out = new Map<string, LayerState>(ids.map((id) => [id, "not_saved"]));
  if (!ids.length) return out;
  for (const r of db.select({ id: s.noteSaves.targetId }).from(s.noteSaves).where(and(eq(s.noteSaves.targetType, type), inArray(s.noteSaves.targetId, ids))).all()) out.set(r.id, "saved");
  return out;
}
const layerStates = (db: Db, layerIds: string[]) => targetStates(db, "layer", layerIds);

/** The layers the student has started: something was written back or asked in the layer's chat, whether or not it was saved. */
export function startedLayers(db: Db, layerIds: string[]): Set<string> {
  if (!layerIds.length) return new Set();
  const wrote = db.select({ id: s.writebacks.targetId }).from(s.writebacks).where(and(eq(s.writebacks.targetType, "layer"), inArray(s.writebacks.targetId, layerIds))).all();
  const asked = db.select({ id: s.layerMessages.targetId }).from(s.layerMessages).where(and(eq(s.layerMessages.targetType, "layer"), inArray(s.layerMessages.targetId, layerIds))).all();
  return new Set([...wrote, ...asked].map((r) => r.id));
}

/** A plain line about a week, built from its big questions. No AI involved. */
function aboutWeek(label: string, questions: string[]): string {
  if (!questions.length) return "";
  const quote = (q: string) => `“${q.trim()}”`;
  if (questions.length === 1) return `${label} is one layer. It asks ${quote(questions[0])}`;
  return `${label} is ${questions.length} layers. It begins with ${quote(questions[0])} and builds, idea by idea, to ${quote(questions[questions.length - 1])}`;
}

/** The course's week rows in week order (only weeks that have layers or a synthesis have a row). */
export function partRows(db: Db, projectId: string) {
  return db.select().from(s.parts).where(eq(s.parts.projectId, projectId)).orderBy(asc(s.parts.position), asc(s.parts.key)).all();
}

/** Optional readings attached to each layer, by file name. */
function extrasOf(db: Db, layerIds: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!layerIds.length) return out;
  const rows = db.select({ layerId: s.layerOptional.layerId, name: s.files.name }).from(s.layerOptional).innerJoin(s.files, eq(s.files.id, s.layerOptional.fileId)).where(inArray(s.layerOptional.layerId, layerIds)).all();
  for (const r of rows) out.set(r.layerId, [...(out.get(r.layerId) ?? []), r.name]);
  return out;
}

const LOOSE_KEY = "loose-optional";
function looseOptionalIds(db: Db, projectId: string): string[] {
  return ((db.select({ v: s.uiState.value }).from(s.uiState).where(and(eq(s.uiState.projectId, projectId), eq(s.uiState.key, LOOSE_KEY))).get()?.v ?? []) as string[]) ?? [];
}
function setLooseOptional(db: Db, projectId: string, ids: string[]) {
  db.insert(s.uiState).values({ id: `${projectId}:${LOOSE_KEY}`, projectId, key: LOOSE_KEY, value: ids }).onConflictDoUpdate({ target: [s.uiState.projectId, s.uiState.key], set: { value: ids } }).run();
}

/** The course's weeks as Claude read them from the syllabus at import: date, title and what the syllabus says, by week. */
function weekFacts(db: Db, projectId: string) {
  const weeks = new Map(courseWeekRows(db, projectId).map((w) => [w.week, w]));
  return { weeks, titles: courseWeekTitles(db, projectId) };
}

/** The label of a week row. */
const rowLabel = (row: { week: number | null; title: string; key: string }) => (row.week !== null ? weekName(row.week, row.title) : row.title || row.key);

export function getStructure(db: Db, projectId: string): StructureModel | null {
  const project = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get();
  if (!project) return null;
  migratePartsToWeeks(db, projectId); // a course from before the weeks round, opened before the database was reopened
  const all = new Map(readingOrder(db, projectId).map((p) => [p.passageId, p]));
  // a week made for new material waits, unseen, until its layers are approved in What's new
  const rows = partRows(db, projectId).filter((p) => p.week !== null && (p.breakdownStatus === "approved" || layerRows(db, p.id).length > 0 || !hasProposedLayers(db, p.id)));
  const layerIds = rows.flatMap((p) => layerRows(db, p.id).map((l) => l.id));
  const states = layerStates(db, layerIds);
  const synthStates = targetStates(db, "part", rows.map((p) => p.id));
  const extras = extrasOf(db, layerIds);
  const weekOf = passageWeeks(db, projectId);
  const { weeks: syllabusWeeks, titles } = weekFacts(db, projectId);
  const count = courseWeekCount(db, projectId) ?? 0;
  const top = Math.max(count, 0, ...rows.map((r) => r.week!));
  const materialWeeks = new Set([...weekOf.values()]);

  const byWeek = new Map(rows.map((r) => [r.week!, r]));
  const weeks: StructureWeek[] = [];
  for (let w = 1; w <= top; w++) {
    const row = byWeek.get(w);
    const title = row?.title || titles.get(w) || "";
    const label = weekName(w, title);
    const layers: StructureLayer[] = (row ? layerRows(db, row.id) : []).map((l) => {
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
        newMaterial: l.newMaterialAt !== null && l.contentStatus !== "none",
        state: states.get(l.id) ?? "not_saved",
        weeks: weekSet(ps.map((p) => weekOf.get(p.passageId)).filter((x): x is number => x !== undefined)),
        sources: sourcesOf(ps),
        optional: l.optional,
        extras: extras.get(l.id) ?? [],
      };
    });
    weeks.push({
      id: row?.id ?? null,
      week: w,
      key: weekKey(w),
      title,
      label,
      status: row?.breakdownStatus ?? "approved",
      hasMaterial: layers.length > 0 || materialWeeks.has(w),
      words: layers.reduce((n, l) => n + l.words, 0),
      layers,
      progress: countStates(layers.map((l) => l.state)),
      synthesis: row ? (synthStates.get(row.id) ?? "not_saved") : "not_saved",
      about: aboutWeek(label, layers.map((l) => l.bigQuestion)),
    });
  }
  const allLayers = weeks.flatMap((w) => w.layers);
  const resume = allLayers.find((l) => l.state !== "saved");
  const withMaterial = weeks.filter((w) => w.layers.length).map((w) => w.week);
  const dated = weeks.map((w) => ({ week: w.week, date: syllabusWeeks.get(w.week)?.date ?? null, hasNotes: w.layers.length > 0 }));
  const loose = looseOptionalIds(db, projectId);
  const looseFiles = loose.length ? db.select({ id: s.files.id, name: s.files.name }).from(s.files).where(inArray(s.files.id, loose)).all() : [];
  const attachedTo = loose.length ? db.select({ fileId: s.layerOptional.fileId, layerId: s.layerOptional.layerId, title: s.layers.title }).from(s.layerOptional).innerJoin(s.layers, eq(s.layers.id, s.layerOptional.layerId)).where(inArray(s.layerOptional.fileId, loose)).all() : [];
  return {
    project: { id: project.id, name: project.name, courseCode: project.courseCode, status: project.status, isDemo: project.isDemo },
    weeks,
    progress: countStates(allLayers.map((l) => l.state)),
    resume: resume ? { layerId: resume.id, title: resume.title } : null,
    weekCount: top,
    currentWeek: withMaterial.length ? Math.min(currentWeek(dated), Math.max(...withMaterial)) : 1,
    note: (db.select({ v: s.uiState.value }).from(s.uiState).where(and(eq(s.uiState.projectId, projectId), eq(s.uiState.key, "structure-note"))).get()?.v as string | undefined) ?? null,
    looseOptional: looseFiles.map((f) => {
      const a = attachedTo.find((x) => x.fileId === f.id);
      return { fileId: f.id, name: f.name, layerId: a?.layerId ?? null, layerTitle: a?.title ?? null };
    }),
  };
}

// ---------------------------------------------------------------- proposing

const toShape = (p: OrderedPassage): ShapePassage => ({ words: p.words, text: p.text, file: p.file, sectionId: p.sectionId, sectionTitle: p.section });

/** A plain plan for a week, used when the AI's answer is unusable twice: one layer per file, then held to the week's shape. */
export function fallbackWeek(passages: OrderedPassage[]): ShapeLayer[] {
  const layers: ShapeLayer[] = [];
  passages.forEach((p, i) => {
    const last = layers[layers.length - 1];
    const name = p.file.replace(/\.[a-z0-9]{1,5}$/i, "");
    if (last && passages[last.passages[last.passages.length - 1] - 1].file === p.file) last.passages.push(i + 1);
    else layers.push({ title: name.slice(0, 80), bigQuestion: `What are the main ideas in ${name}?`.slice(0, 218), buildsOn: layers.length ? `Follows ${layers[layers.length - 1].title}.`.slice(0, 240) : "", passages: [i + 1] });
  });
  return shapeWeek(layers, passages.map(toShape));
}

/**
 * One week's layers: the AI reads the week's full text and proposes the chain of ideas, code checks it. Every passage must be in exactly
 * one layer, no idea twice, and at least two layers once the week has TWO_LAYERS_FROM words; an invalid answer is retried once with the
 * reasons. A plan that covers everything but still repeats an idea (or is one layer) is kept with the repeats merged; one that doesn't
 * cover the text falls back to a layer per file. Either way the week is then held to its shape: two to five layers, and an idea too long
 * for one layer cut by its real parts while there is room.
 */
async function planWeek(engine: Engine, input: { course: string; week: string; syllabus: string | null; passages: OrderedPassage[] }, signal?: AbortSignal): Promise<{ layers: ShapeLayer[]; fallback: boolean }> {
  const { passages } = input;
  const total = passages.reduce((n, p) => n + p.words, 0);
  const minLayers = total >= TWO_LAYERS_FROM && passages.length > 1 ? 2 : 1;
  const listed = passages.map((p, i) => ({ n: i + 1, file: p.file, page: p.page, role: p.role === "lecture" ? "Lecture" : "Reading", section: p.section ?? "", words: p.words, text: p.text, part: opinionPart(p.text) }));
  const textOf = (n: number) => passages[n - 1]?.text ?? "";
  const numbers = (ranges: { from: number; to: number }[]) => {
    const seen = new Set<number>();
    for (const r of ranges) for (let n = r.from; n <= r.to; n++) seen.add(n);
    return [...seen].sort((a, b) => a - b);
  };
  let feedback: string | undefined;
  let covering: ShapeLayer[] | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const proposal = await proposeWeekLayers(engine, { course: input.course, week: input.week, syllabus: input.syllabus, passages: listed, minLayers, feedback }, signal);
      const { errors } = validateBreakdown(proposal.layers, passages.length);
      if (proposal.layers.length < minLayers) errors.push(`It has 1 layer, but this week has ${total.toLocaleString("en-US")} words of material, so it needs at least 2: find the steps of its chain of ideas.`);
      const layers: ShapeLayer[] = proposal.layers.map((l) => ({ title: l.title.trim(), bigQuestion: l.bigQuestion.trim(), buildsOn: l.buildsOn.trim(), passages: numbers(l.ranges) }));
      const dups = errors.length ? [] : duplicateReasons(layers.map((l) => ({ title: l.title, texts: l.passages.map(textOf) })));
      if (!errors.length && !dups.length) return { layers: shapeWeek(layers, passages.map(toShape)), fallback: false };
      if (!errors.length || (errors.length === 1 && proposal.layers.length < minLayers)) covering = layers;
      feedback = [...errors, ...dups].slice(0, 6).join(" ");
    } catch (e) {
      if (!(e instanceof BadStructuredOutput)) throw e; // a missing or logged-out claude, or a cancel, is not an invalid answer
      feedback = "It did not match the required JSON shape.";
    }
  }
  if (covering) {
    // repeats merged: the later layer's passages join the earlier one
    const out = covering.map((l) => ({ ...l, passages: [...l.passages] }));
    for (;;) {
      const pairs = duplicatePairs(out.map((l) => ({ title: l.title, texts: l.passages.map(textOf) })));
      if (!pairs.length) break;
      const [i, j] = pairs[0];
      out[i].passages = [...out[i].passages, ...out[j].passages].sort((a, b) => a - b);
      out.splice(j, 1);
    }
    return { layers: shapeWeek(out, passages.map(toShape)), fallback: false };
  }
  return { layers: fallbackWeek(passages), fallback: true };
}

/**
 * The course's own material by week: each passage goes to its file's week. A passage whose file has no week stays with the passage
 * before it in reading order (or week 1, at the very start).
 */
export function passagesByWeek(db: Db, projectId: string): Map<number, OrderedPassage[]> {
  const weekOf = passageWeeks(db, projectId);
  const out = new Map<number, OrderedPassage[]>();
  const order = courseOrder(db, projectId);
  let last = order.map((p) => weekOf.get(p.passageId)).find((w) => w !== undefined) ?? 1;
  for (const p of order) {
    const w = weekOf.get(p.passageId) ?? last;
    last = w;
    out.set(w, [...(out.get(w) ?? []), p]);
  }
  return new Map([...out].sort((a, b) => a[0] - b[0]));
}

/**
 * Propose the course plan: for every week with material, its layers (the chain of ideas, two to five). The AI proposes, code checks:
 * every passage of the course's own material lands in exactly one layer of its own week. Weeks are planned side by side (the engine runs
 * at most two at once); a cancel stops every call. Nothing is written to the layers' content here; the student approves the plan first.
 */
export async function proposeStructure(db: Db, engine: Engine, projectId: string, signal?: AbortSignal) {
  const byWeek = passagesByWeek(db, projectId);
  const total = [...byWeek.values()].reduce((n, ps) => n + ps.length, 0);
  if (total < 2) throw new StructureError("There isn't enough text to plan layers from yet. Add more files to the project first.");
  const approved = db.select().from(s.parts).where(and(eq(s.parts.projectId, projectId), eq(s.parts.breakdownStatus, "approved"))).all();
  if (approved.length) throw new GateError("This plan is already approved. Edit its layers instead of proposing it again.");

  const { weeks: syllabusWeeks, titles } = weekFacts(db, projectId);
  const names = new Map([...byWeek.keys()].map((w) => [w, weekName(w, titles.get(w))]));
  const project = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get()!;
  const course = [project.courseCode, project.name].filter(Boolean).join(" · ");
  // one failed week stops the others: their answers would be thrown away anyway
  const stop = new AbortController();
  const onAbort = () => stop.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) stop.abort();
  let results: { week: number; layers: ShapeLayer[]; fallback: boolean }[];
  try {
    results = await Promise.all(
      [...byWeek].map(async ([week, passages]) => {
        try {
          const r = await planWeek(engine, { course, week: names.get(week)!, syllabus: syllabusWeeks.get(week)?.syllabus || null, passages }, stop.signal);
          return { week, ...r };
        } catch (e) {
          stop.abort();
          throw e;
        }
      }),
    );
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  if (signal?.aborted) throw new StructureError("Stopped.");
  const fellBack = results.filter((r) => r.fallback).map((r) => names.get(r.week)!);

  db.transaction((tx) => {
    tx.delete(s.parts).where(eq(s.parts.projectId, projectId)).run(); // cascades to layers and their passages
    for (const { week, layers } of results) {
      const passages = byWeek.get(week)!;
      const partId = nanoid(10);
      tx.insert(s.parts).values({ id: partId, projectId, key: weekKey(week), title: titles.get(week) ?? "", week, position: week }).run();
      layers.forEach((l, lp) => {
        const layerId = nanoid(10);
        tx.insert(s.layers).values({ id: layerId, partId, position: lp, title: l.title.trim(), bigQuestion: l.bigQuestion.trim(), buildsOn: l.buildsOn.trim() }).run();
        // a layer's own passages stay in reading order, whatever order its ranges were given in
        [...l.passages].sort((a, b) => a - b).forEach((n, ordinal) => tx.insert(s.layerPassages).values({ layerId, passageId: passages[n - 1].passageId, ordinal }).run());
      });
    }
    attachOptional(tx, projectId);
    tx.update(s.projects).set({ status: "building" }).where(eq(s.projects.id, projectId)).run();
    tx.delete(s.uiState).where(and(eq(s.uiState.projectId, projectId), eq(s.uiState.key, "structure-note"))).run();
    if (fellBack.length)
      tx.insert(s.uiState).values({ id: `${projectId}:structure-note`, projectId, key: "structure-note", value: `Margin couldn't get a valid plan for ${fellBack.join(", ")} from Claude, so ${fellBack.length > 1 ? "those weeks were" : "that week was"} split by file instead. Rename, merge or split the layers below, or suggest the layers again.` }).run();
  });
}

// ---------------------------------------------------------------- optional readings

const counts = (words: string[]) => {
  const m = new Map<string, number>();
  for (const t of words) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
};
/**
 * How close two bags of words are: cosine of counts, each word weighted by how rare it is across the course's layers, so words every
 * layer uses ("government", "power") count for little and a topic's own names count for a lot.
 */
function closeness(a: Map<string, number>, b: Map<string, number>, idf: (t: string) => number): number {
  let dot = 0;
  for (const [t, n] of a) if (b.has(t)) dot += n * idf(t) * b.get(t)! * idf(t);
  const norm = (m: Map<string, number>) => Math.sqrt([...m].reduce((x, [t, n]) => x + (n * idf(t)) ** 2, 0)) || 1;
  return dot / (norm(a) * norm(b));
}
/** Below this, no layer's topic is close enough: the reading covers something the required material doesn't. */
export const OPTIONAL_FIT = 0.1;

/** A scorer for "which layer does this text fit": each approved or proposed layer, by words in common (rare words weigh more) and week. */
export function layerFitter(db: Db, projectId: string) {
  const all = new Map(readingOrder(db, projectId).map((p) => [p.passageId, p]));
  const rows = partRows(db, projectId);
  const layers = rows.flatMap((p) => layerRows(db, p.id).filter((l) => !l.optional).map((l) => ({ l, week: p.week })));
  const info = layers.map(({ l, week }) => {
    const ps = layerPassageList(db, l.id, all);
    return { id: l.id, week, words: counts(tokens(`${l.title} ${l.bigQuestion} ${ps.map((p) => p.text).join(" ")}`.slice(0, 60_000))) };
  });
  const df = new Map<string, number>();
  for (const l of info) for (const t of l.words.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log(1 + info.length / (df.get(t) ?? 1));
  return {
    empty: !info.length,
    /** The week a layer belongs to. */
    weekOf: (layerId: string) => info.find((l) => l.id === layerId)?.week ?? null,
    /** Whether any layer is in this week. */
    hasWeek: (week: number) => info.some((l) => l.week === week),
    /** Layers best first: a layer of the reading's own week always comes before the rest, then by words in common. */
    rank(text: string, week: number | null) {
      const words = counts(tokens(text.slice(0, 30_000)));
      return info
        .map((l) => ({ layerId: l.id, fit: closeness(words, l.words, idf), sameWeek: week !== null && l.week === week }))
        .sort((a, b) => Number(b.sameWeek) - Number(a.sameWeek) || b.fit - a.fit);
    },
  };
}

/**
 * Attach every optional reading to the layer whose topic it fits: a layer of its own week first (its week from the syllabus's reading list
 * or its name), then by words in common. A reading whose week has no layers (no week, or a week past the material) is placed by its words,
 * and takes the week of the layer it joins, so its week always matches the layer it sits beside. One that fits no layer well is still
 * attached to the closest, and is listed on the plan as a possible optional layer. Idempotent: readings already attached keep their layer;
 * ones made into their own layer are left alone.
 */
export function attachOptional(db: Db, projectId: string) {
  const files = db.select().from(s.files).where(and(eq(s.files.projectId, projectId), eq(s.files.category, "optional"), eq(s.files.status, "done"))).all();
  if (!files.length) return;
  const fitter = layerFitter(db, projectId);
  if (fitter.empty) return;
  const inOwnLayer = new Set(
    db.select({ f: s.passages.fileId }).from(s.layerPassages).innerJoin(s.passages, eq(s.passages.id, s.layerPassages.passageId)).where(inArray(s.passages.fileId, files.map((f) => f.id))).all().map((r) => r.f),
  );
  const live = new Set(partRows(db, projectId).flatMap((p) => layerRows(db, p.id).map((l) => l.id)));
  const loose = new Set(looseOptionalIds(db, projectId));
  for (const f of files) {
    if (inOwnLayer.has(f.id)) {
      loose.delete(f.id);
      continue;
    }
    const existing = db.select().from(s.layerOptional).where(eq(s.layerOptional.fileId, f.id)).all();
    if (existing.some((e) => live.has(e.layerId))) continue;
    const week = f.week !== null && fitter.hasWeek(f.week) ? f.week : null;
    const scored = fitter.rank((f.parsed ?? []).map((b) => b.text).join(" "), week);
    db.insert(s.layerOptional).values({ layerId: scored[0].layerId, fileId: f.id }).onConflictDoNothing().run();
    // a reading with no week of its own takes the week of the layer it sits beside, marked for the student to check
    const w = fitter.weekOf(scored[0].layerId);
    if (w !== null && f.week === null) db.update(s.files).set({ week: w, needsCheck: true, reason: `${f.reason ? `${f.reason.replace(/\.?$/, ".")} ` : ""}Placed beside a Week ${w} layer whose topic it fits; check this.` }).where(eq(s.files.id, f.id)).run();
    if (Math.max(...scored.map((x) => x.fit)) < OPTIONAL_FIT) loose.add(f.id);
    else loose.delete(f.id);
  }
  setLooseOptional(db, projectId, [...loose]);
}

/** "Add as optional layer": the reading becomes a layer of its own (marked optional), in the week of the layer it was attached to. */
export function addOptionalLayer(db: Db, projectId: string, fileId: string): string {
  return db.transaction((tx) => {
    const f = tx.select().from(s.files).where(and(eq(s.files.id, fileId), eq(s.files.projectId, projectId), eq(s.files.category, "optional"))).get();
    if (!f) throw new StructureError("That optional reading is no longer in this project.");
    const attached = tx.select().from(s.layerOptional).where(eq(s.layerOptional.fileId, fileId)).get();
    const near = attached ? tx.select().from(s.layers).where(eq(s.layers.id, attached.layerId)).get() : undefined;
    const rows = partRows(tx, projectId);
    const partId = near?.partId ?? rows[rows.length - 1]?.id;
    if (!partId) throw new StructureError("Plan the layers first.");
    const siblings = layerRows(tx, partId);
    const at = near ? near.position + 1 : siblings.length;
    tx.update(s.layers).set({ position: sql`${s.layers.position} + 1` }).where(and(eq(s.layers.partId, partId), sql`${s.layers.position} >= ${at}`)).run();
    const id = nanoid(10);
    const stem = f.name.replace(/\.[a-z0-9]{1,5}$/i, "").slice(0, 70);
    tx.insert(s.layers).values({ id, partId, position: at, title: stem, bigQuestion: `What does ${stem} add to the course?`, buildsOn: near ? `Goes further than ${near.title}.` : "", optional: true }).run();
    const ps = readingOrder(tx, projectId).filter((p) => p.fileId === fileId);
    ps.forEach((p, i) => tx.insert(s.layerPassages).values({ layerId: id, passageId: p.passageId, ordinal: i }).run());
    tx.delete(s.layerOptional).where(eq(s.layerOptional.fileId, fileId)).run();
    setLooseOptional(tx, projectId, looseOptionalIds(tx, projectId).filter((x) => x !== fileId));
    closeGaps(tx, partId);
    return id;
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

/** Merge a layer with the next one in its week. The first layer's title and question are kept; written content becomes stale. */
export function mergeWithNext(db: Db, layerId: string) {
  db.transaction((tx) => {
    const { layer } = loadLayer(tx, layerId);
    const next = layerRows(tx, layer.partId).find((l) => l.position > layer.position);
    if (!next) throw new StructureError("This is the last layer of its week, so there is nothing to merge it with.");
    const keep = tx.select().from(s.layerPassages).where(eq(s.layerPassages.layerId, layer.id)).all().length;
    const moved = tx.select().from(s.layerPassages).where(eq(s.layerPassages.layerId, next.id)).orderBy(asc(s.layerPassages.ordinal)).all();
    moved.forEach((r, i) => tx.update(s.layerPassages).set({ layerId: layer.id, ordinal: keep + i }).where(eq(s.layerPassages.passageId, r.passageId)).run());
    tx.update(s.layerOptional).set({ layerId: layer.id }).where(eq(s.layerOptional.layerId, next.id)).run();
    tx.delete(s.layers).where(eq(s.layers.id, next.id)).run();
    closeGaps(tx, layer.partId);
    staleIfWritten(tx, layer.id);
  });
}

/**
 * Split a layer in two: at a real part (a court case's next opinion, a new file, a new heading) near the middle by word count. The second
 * half is named for its part, for the student to rename.
 */
export function splitLayer(db: Db, layerId: string) {
  db.transaction((tx) => {
    const { layer, part } = loadLayer(tx, layerId);
    const ps = layerPassageList(tx, layer.id, new Map(readingOrder(tx, part.projectId).map((p) => [p.passageId, p])));
    if (ps.length < 2) throw new StructureError("This layer is a single passage, so it can't be split.");
    const [first, second] = splitByParts({ title: layer.title, bigQuestion: layer.bigQuestion, buildsOn: layer.buildsOn, passages: ps.map((_, i) => i + 1) }, ps.map(toShape), 2);
    if (!second) throw new StructureError("This layer can't be split.");
    tx.update(s.layers).set({ position: sql`${s.layers.position} + 1` }).where(and(eq(s.layers.partId, layer.partId), sql`${s.layers.position} > ${layer.position}`)).run();
    const newId = nanoid(10);
    tx.insert(s.layers).values({ id: newId, partId: layer.partId, position: layer.position + 1, title: second.title, bigQuestion: second.bigQuestion, buildsOn: second.buildsOn }).run();
    second.passages.forEach((n, i) => tx.update(s.layerPassages).set({ layerId: newId, ordinal: i }).where(eq(s.layerPassages.passageId, ps[n - 1].passageId)).run());
    if (first.title !== layer.title) tx.update(s.layers).set({ title: first.title }).where(eq(s.layers.id, layer.id)).run();
    staleIfWritten(tx, layer.id);
  });
}

export function closeGaps(db: Db, partId: string) {
  layerRows(db, partId).forEach((l, i) => db.update(s.layers).set({ position: i }).where(eq(s.layers.id, l.id)).run());
}

function hasProposedLayers(db: Db, partId: string): boolean {
  return !!db.select({ id: s.layers.id }).from(s.layers).where(and(eq(s.layers.partId, partId), eq(s.layers.proposed, true))).get();
}

function hasSynthesisWork(db: Db, partId: string): boolean {
  const n = db.get<{ c: number }>(sql`select (select count(*) from writebacks where target_type = 'part' and target_id = ${partId}) + (select count(*) from note_saves where target_type = 'part' and target_id = ${partId}) + (select count(*) from layer_messages where target_type = 'part' and target_id = ${partId}) as c`);
  return (n?.c ?? 0) > 0;
}

/** The row for a week of this course, made (in the plan's state) if the week has none yet. */
export function weekRowFor(db: Db, projectId: string, week: number, status: "proposed" | "approved" = "proposed"): string {
  const had = db.select({ id: s.parts.id }).from(s.parts).where(and(eq(s.parts.projectId, projectId), eq(s.parts.week, week))).get();
  if (had) return had.id;
  const id = nanoid(10);
  const title = weekFacts(db, projectId).titles.get(week) ?? "";
  db.insert(s.parts).values({ id, projectId, key: weekKey(week), title, week, position: week, breakdownStatus: status, approvedAt: status === "approved" ? Date.now() : null }).run();
  return id;
}

/** A week left with no layers loses its row, unless the student wrote a synthesis for it. */
function dropIfEmpty(db: Db, partId: string) {
  const left = db.select({ id: s.layers.id }).from(s.layers).where(eq(s.layers.partId, partId)).get();
  if (!left && !hasSynthesisWork(db, partId)) db.delete(s.parts).where(eq(s.parts.id, partId)).run();
}

/** Put a layer into another week's row: at the start (`first`) or at the end. */
function intoWeek(db: Db, layerId: string, fromId: string, to: string, first: boolean) {
  if (first) {
    db.update(s.layers).set({ position: sql`${s.layers.position} + 1` }).where(eq(s.layers.partId, to)).run();
    db.update(s.layers).set({ partId: to, position: 0 }).where(eq(s.layers.id, layerId)).run();
  } else db.update(s.layers).set({ partId: to, position: layerRows(db, to).length }).where(eq(s.layers.id, layerId)).run();
  closeGaps(db, fromId);
  dropIfEmpty(db, fromId);
}

/** Move a layer up or down. At the edge of its week it crosses into the week before or after that has layers. */
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
    const weeks = partRows(tx, part.projectId);
    const wi = weeks.findIndex((p) => p.id === part.id);
    const other = weeks[direction === "up" ? wi - 1 : wi + 1];
    if (!other) throw new StructureError(direction === "up" ? "This is the first layer of the course." : "This is the last layer of the course.");
    intoWeek(tx, layer.id, part.id, other.id, direction === "down");
  });
}

/** Move a layer to another week of the course (one with no layers yet too): to the start of a later week, the end of an earlier one. */
export function moveLayerToWeek(db: Db, layerId: string, week: number) {
  db.transaction((tx) => {
    const { layer, part } = loadLayer(tx, layerId);
    if (part.week === week) return;
    const count = courseWeekCount(tx, part.projectId) ?? 0;
    if (!Number.isInteger(week) || week < 1 || week > Math.max(count, ...partRows(tx, part.projectId).map((p) => p.week ?? 0))) throw new StructureError("Pick one of this course's weeks.");
    const to = weekRowFor(tx, part.projectId, week, part.breakdownStatus);
    intoWeek(tx, layer.id, part.id, to, (part.week ?? 0) < week);
  });
}

/** Rename a week's topic. An empty name leaves it as just "Week 3". */
export function renameWeek(db: Db, partId: string, title: string) {
  db.update(s.parts).set({ title: title.trim().slice(0, 70) }).where(eq(s.parts.id, partId)).run();
}

/**
 * Approve the plan ("Looks good"): every week at once. Only now may layers' content be written. Every passage of the course's own material
 * must be in a layer.
 */
export function approvePlan(db: Db, projectId: string) {
  db.transaction((tx) => {
    const rows = partRows(tx, projectId);
    if (!rows.some((p) => layerRows(tx, p.id).length)) throw new StructureError("Propose the layers first.");
    const placed = new Set(tx.select({ id: s.layerPassages.passageId }).from(s.layerPassages).innerJoin(s.layers, eq(s.layers.id, s.layerPassages.layerId)).innerJoin(s.parts, eq(s.parts.id, s.layers.partId)).where(and(eq(s.parts.projectId, projectId), eq(s.layers.proposed, false))).all().map((r) => r.id));
    if (courseOrder(tx, projectId).some((p) => !placed.has(p.passageId))) throw new StructureError("Some of the text isn't in any layer. Propose the layers again.");
    for (const p of rows) tx.update(s.parts).set({ breakdownStatus: "approved", approvedAt: Date.now() }).where(eq(s.parts.id, p.id)).run();
    tx.update(s.projects).set({ status: "ready" }).where(eq(s.projects.id, projectId)).run();
  });
}

export { rowLabel };

// ---------------------------------------------------------------- writing a layer

export function getLayer(db: Db, layerId: string): LayerView | null {
  const found = db.select().from(s.layers).where(eq(s.layers.id, layerId)).get();
  if (!found) return null;
  const projectOf = db.select({ p: s.parts.projectId }).from(s.parts).where(eq(s.parts.id, found.partId)).get();
  if (projectOf) migratePartsToWeeks(db, projectOf.p); // the layer's course is still in Parts: move it first
  const layer = db.select().from(s.layers).where(eq(s.layers.id, layerId)).get()!;
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
    newMaterial: layer.newMaterialAt !== null && layer.contentStatus !== "none",
    week: { week: part.week ?? 0, key: part.key, label: rowLabel(part), status: part.breakdownStatus },
    previous: pick(rows[i - 1]),
    next: pick(rows[i + 1]),
    content: content ? { explained: content.explained, source: content.source, writtenAt: content.writtenAt } : null,
    optional: optionalFor(db, layer.id, `${layer.title} ${layer.bigQuestion}`),
  };
}

/**
 * The passages of the optional readings attached to a layer that are closest to `query` (words in common), `perFile` of each, in page
 * order. Copied from storage by code, never written by the AI.
 */
export function optionalFor(db: Db, layerId: string, query: string, perFile = 2): OptionalQuote[] {
  const files = db.select({ id: s.files.id, name: s.files.name }).from(s.layerOptional).innerJoin(s.files, eq(s.files.id, s.layerOptional.fileId)).where(eq(s.layerOptional.layerId, layerId)).all();
  if (!files.length) return [];
  const want = new Set(tokens(query));
  const out: OptionalQuote[] = [];
  for (const f of files) {
    const ps = db.select({ id: s.passages.id, page: s.passages.page, text: s.passages.text, ordinal: s.passages.ordinal, sec: s.sections.position }).from(s.passages).innerJoin(s.sections, eq(s.sections.id, s.passages.sectionId)).where(eq(s.passages.fileId, f.id)).all();
    const scored = ps.map((p) => ({ p, score: tokens(p.text).filter((t) => want.has(t)).length })).sort((a, b) => b.score - a.score || a.p.sec - b.p.sec || a.p.ordinal - b.p.ordinal);
    const picked = scored.slice(0, perFile).map((x) => x.p).sort((a, b) => a.sec - b.sec || a.ordinal - b.ordinal);
    for (const p of picked) out.push({ passageId: p.id, file: f.name, page: p.page, text: p.text });
  }
  return out;
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

/**
 * The layers being written in this server, and each one's priority (a layer written ahead, "background", moves up when the student opens
 * it). On globalThis: Next loads the background worker and the routes as separate copies of this module, and both must see one list, or
 * opening a layer the worker is writing would start a second job beside it.
 */
const shared = <T,>(key: string, make: () => T): T => ((globalThis as unknown as Record<string, T>)[key] ??= make());
const inflight = shared("__margin_layers_inflight__", () => new Map<string, Promise<void>>());
const priorities = shared("__margin_layers_priority__", () => new Map<string, "now" | "background">());

/**
 * The student opened a layer that is already being written ahead: its calls, running or waiting, go first from now on, and the quiet clock
 * starts again (a background layer may have been waiting its turn).
 */
export function promoteLayer(layerId: string) {
  if (!priorities.has(layerId) || priorities.get(layerId) === "now") return;
  priorities.set(layerId, "now");
  touch(layerId);
  requeue();
}

/** Margin stops writing a layer only when nothing new has happened in it (no new text, no step done) for this long. MARGIN_LAYER_IDLE_S (seconds). */
export function layerIdleMs(env: Record<string, string | undefined> = process.env): number {
  const v = Number(env.MARGIN_LAYER_IDLE_S);
  return (Number.isFinite(v) && v > 0 ? v : 180) * 1000;
}

/**
 * What is already finished of a layer that failed part-way (its Source picks, or its Explained), so Try again only does what is missing.
 * Kept in ui_state against the layer's passages, title and question: if any of those change, the draft no longer counts.
 */
interface LayerDraft {
  hash: string;
  source?: s.SourceQuote[];
  explained?: ExplainedV2;
}
const draftKey = (layerId: string) => `layer-draft:${layerId}`;
function readDraft(db: Db, projectId: string, layerId: string, hash: string): LayerDraft | null {
  const v = db.select({ v: s.uiState.value }).from(s.uiState).where(and(eq(s.uiState.projectId, projectId), eq(s.uiState.key, draftKey(layerId)))).get()?.v as LayerDraft | undefined;
  return v && v.hash === hash ? v : null;
}
function saveDraft(db: Db, projectId: string, layerId: string, draft: LayerDraft) {
  db.insert(s.uiState).values({ id: `${projectId}:${draftKey(layerId)}`, projectId, key: draftKey(layerId), value: draft }).onConflictDoUpdate({ target: [s.uiState.projectId, s.uiState.key], set: { value: draft } }).run();
}

/** The files a layer's passages come from, and whether the brain has read every one of them. */
function layerFiles(db: Db, passages: OrderedPassage[]): { fileIds: string[]; allRead: boolean } {
  const fileIds = [...new Set(passages.map((p) => p.fileId).filter((f): f is string => !!f))];
  const read = fileIds.length ? new Set(db.select({ id: s.brainReads.fileId }).from(s.brainReads).where(inArray(s.brainReads.fileId, fileIds)).all().map((r) => r.id)) : new Set<string>();
  return { fileIds, allRead: fileIds.every((f) => read.has(f)) };
}

/**
 * Write a layer's Source and Explained tabs, once, then cache them. The plan must be approved first (GateError, no engine call). Two calls
 * run side by side: the AI picks which of the layer's passages the Source tab shows (code copies their exact text), and it writes the
 * explanation, streamed into the progress record (layer-progress.ts) so the page shows it as it comes. Brain building never holds it up:
 * it uses whatever notes the brain has on the layer's passages, asks the brain to read the layer's unread files next, and leaves the
 * named-things check for `checkLayerConcepts` once they are read. Whatever finishes is kept if the other part fails. It stops only when
 * nothing new has happened for `idleMs`, so the page never waits forever. "now" is a layer the student opened; "background" one written
 * ahead, which never takes the places a student's call needs (lib/ai/queue.ts).
 */
export function writeLayerContent(
  db: Db,
  engine: Engine,
  layerId: string,
  { signal, idleMs = layerIdleMs(), priority = "now" }: { signal?: AbortSignal; idleMs?: number; priority?: "now" | "background" } = {},
): Promise<void> {
  const { layer, part } = loadLayer(db, layerId);
  if (part.breakdownStatus !== "approved") throw new GateError("Approve the course plan first. Nothing is written until you do.");
  if (layer.contentStatus === "ready") return Promise.resolve();
  const running = inflight.get(layerId);
  if (running) return running;

  const job = (async () => {
    const before = layer.contentStatus;
    db.update(s.layers).set({ contentStatus: "writing" }).where(eq(s.layers.id, layerId)).run();
    startProgress(layerId, idleMs);
    priorities.set(layerId, priority);
    const call = { priority: () => priorities.get(layerId) ?? priority, onActivity: () => touch(layerId) };
    // one stop for both calls: the student's cancel, or nothing new from Claude for idleMs while the student waits (a layer written ahead
    // may wait its turn behind the brain; each of its calls still has the engine's own quiet limit)
    const stop = new AbortController();
    let idle = false;
    const onAbort = () => stop.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const watch = setInterval(() => {
      if (call.priority() === "background") return touch(layerId);
      if (Date.now() - lastActivity(layerId) <= idleMs) return;
      idle = true;
      stop.abort();
    }, Math.min(5_000, idleMs / 4));
    let draft: LayerDraft = { hash: "" };
    try {
      const all = new Map(readingOrder(db, part.projectId).map((p) => [p.passageId, p]));
      const passages = layerPassageList(db, layerId, all);
      const rows = layerRows(db, part.id);
      const i = rows.findIndex((r) => r.id === layerId);
      const ref = (r?: { title: string; bigQuestion: string }) => (r ? { title: r.title, bigQuestion: r.bigQuestion } : undefined);
      const about = { title: layer.title, bigQuestion: layer.bigQuestion };
      const hash = createHash("sha256").update(JSON.stringify([about, passages.map((p) => p.passageId)])).digest("hex").slice(0, 16);
      draft = readDraft(db, part.projectId, layerId, hash) ?? { hash };
      if (draft.source) setStep(layerId, "source", "done");
      if (draft.explained) {
        setStep(layerId, "explained", "done");
        setStep(layerId, "check", "done");
      }

      const words = passages.reduce((n, p) => n + p.words, 0);
      const pickSource = async () => {
        if (draft.source) return;
        setStep(layerId, "source", "working");
        const pick = await pickLayerSource(engine, { layer: about, passages: passages.map((p) => ({ n: p.n, file: p.file, page: p.page, text: p.text })) }, stop.signal, call);
        draft.source = copySource(pick.passages, passages, quoteBlocks(db, passages.map((p) => p.passageId)));
        setStep(layerId, "source", "done");
      };
      const explain = async () => {
        if (draft.explained) return;
        setStep(layerId, "explained", "working");
        // the brain's notes so far; files it hasn't read go to the front of its queue, and the named-things check waits for them
        const { fileIds, allRead } = layerFiles(db, passages);
        if (!allRead) wantBrainFiles(fileIds);
        const known = layerConcepts(db, part.projectId, passages.map((p) => p.passageId));
        const weekWords = rows.flatMap((r) => layerPassageList(db, r.id, all)).reduce((n, p) => n + p.words, 0);
        const project = db.select().from(s.projects).where(eq(s.projects.id, part.projectId)).get()!;
        const { explained, conceptsChecked } = await writeExplained(
          engine,
          {
            course: [project.courseCode, project.name].filter(Boolean).join(" · "),
            week: { label: rowLabel(part), syllabus: part.week !== null ? courseWeekRows(db, part.projectId).find((w) => w.week === part.week)?.syllabus || null : null },
            layer: about,
            passages: passages.map((p) => ({ file: p.file, page: p.page, text: p.text })),
            notes: known.notes,
            readings: known.readings,
            previous: ref(rows[i - 1]),
            next: ref(rows[i + 1]),
            length: explainedBudget(words, weekWords),
          },
          {
            signal: stop.signal,
            call,
            onText: (text) => setText(layerId, text),
            onStage: () => {
              setStep(layerId, "explained", "done");
              setStep(layerId, "check", "working");
            },
          },
        );
        draft.explained = { ...explained, version: 2, question: layer.bigQuestion, conceptsChecked: conceptsChecked && allRead };
        setStep(layerId, "explained", "done");
        setStep(layerId, "check", "done");
      };
      // A failure the other call can't get past either (the plan's limit, a logged-out or missing claude) stops both at once; any other
      // failure lets the other call finish, so its work is kept for Try again.
      const fatal = (e: unknown) => {
        if (e instanceof EngineError && ["UsageLimitReached", "ClaudeNotLoggedIn", "ClaudeNotInstalled"].includes(e.code)) stop.abort();
        throw e;
      };
      const results = await Promise.allSettled([pickSource().catch(fatal), explain().catch(fatal)]);
      const errors = results.flatMap((r) => (r.status === "rejected" ? [r.reason as unknown] : []));
      if (errors.length) {
        const aborted = (e: unknown) => e instanceof EngineError && e.code === "EngineAborted";
        if (idle && errors.every(aborted)) throw new EngineTimeout(`Nothing new came from Claude for ${spanWords(idleMs)}, so Margin stopped waiting. Try again; anything already finished is kept.`);
        throw errors.find((e) => !aborted(e)) ?? errors[0];
      }
      db.transaction((tx) => {
        tx.delete(s.layerContent).where(eq(s.layerContent.layerId, layerId)).run();
        tx.insert(s.layerContent).values({ id: nanoid(10), layerId, explained: draft.explained!, source: draft.source! }).run();
        tx.update(s.layers).set({ contentStatus: "ready", newMaterialAt: null }).where(eq(s.layers.id, layerId)).run();
        tx.delete(s.uiState).where(and(eq(s.uiState.projectId, part.projectId), eq(s.uiState.key, draftKey(layerId)))).run();
      });
      finishProgress(layerId, { ok: true });
    } catch (e) {
      if (draft.source || draft.explained) saveDraft(db, part.projectId, layerId, draft);
      db.update(s.layers).set({ contentStatus: before === "writing" ? "none" : before }).where(eq(s.layers.id, layerId)).run();
      const kept = [...(draft.source ? (["source"] as const) : []), ...(draft.explained ? (["explained", "check"] as const) : [])];
      finishProgress(layerId, { ok: false, code: e instanceof EngineError ? e.code : "Failed", message: e instanceof Error ? e.message : String(e), kept });
      throw e;
    } finally {
      clearInterval(watch);
      signal?.removeEventListener("abort", onAbort);
    }
  })().finally(() => {
    inflight.delete(layerId);
    priorities.delete(layerId);
  });
  inflight.set(layerId, job);
  return job;
}

/** Written layers whose named-things check waits for the brain to read their files: ready to check now, in course order. */
export function layersAwaitingConcepts(db: Db): string[] {
  const rows = db.select({ layerId: s.layerContent.layerId, explained: s.layerContent.explained }).from(s.layerContent).all();
  return rows
    .filter((r) => isExplainedV2(r.explained) && r.explained.conceptsChecked === false)
    .map((r) => r.layerId)
    .filter((id) => {
      try {
        return layerFiles(db, passagesOfLayer(db, id)).allRead;
      } catch {
        return false;
      }
    });
}

/**
 * The named-things check of a layer written before the brain had read its files: once it has, every concept, person or case the readings
 * discuss that no section explains is added to the section where it matters (`explainMissingConcepts`). Nothing else in the layer changes.
 */
export async function checkLayerConcepts(db: Db, engine: Engine, layerId: string, signal?: AbortSignal): Promise<number> {
  const content = db.select().from(s.layerContent).where(eq(s.layerContent.layerId, layerId)).get();
  if (!content || !isExplainedV2(content.explained) || content.explained.conceptsChecked !== false) return 0;
  const { layer, part } = loadLayer(db, layerId);
  const passages = passagesOfLayer(db, layerId);
  if (!layerFiles(db, passages).allRead) return 0;
  const explained = content.explained;
  const all = new Map(readingOrder(db, part.projectId).map((p) => [p.passageId, p]));
  const weekWords = layerRows(db, part.id).flatMap((r) => layerPassageList(db, r.id, all)).reduce((n, p) => n + p.words, 0);
  const { target } = explainedBudget(passages.reduce((n, p) => n + p.words, 0), weekWords);
  const missing = unexplained(explained.sections, requiredNotes(layerConcepts(db, part.projectId, passages.map((p) => p.passageId)).notes, target));
  const sent = passages.map((p) => ({ file: p.file, page: p.page, text: p.text }));
  const added = missing.length ? await explainMissingConcepts(engine, { layer: { title: layer.title, bigQuestion: layer.bigQuestion }, explained, missing, passages: sent }, signal, { priority: "background" }) : explained;
  const next: ExplainedV2 = { ...cleanExplained(added, sent), version: 2, question: explained.question, conceptsChecked: true };
  db.update(s.layerContent).set({ explained: next }).where(eq(s.layerContent.layerId, layerId)).run();
  return missing.length;
}

/** True while a layer is being written in this server process. */
export const isWriting = (layerId: string) => inflight.has(layerId);

/**
 * "Refresh this layer": write its Explained and Source tabs again from everything the layer holds now. The student's write-ups, saved
 * versions and chat are never touched. The marker clears once the new tabs are written.
 */
export async function refreshLayer(db: Db, engine: Engine, layerId: string, signal?: AbortSignal): Promise<void> {
  const { layer, part } = loadLayer(db, layerId);
  if (part.breakdownStatus !== "approved") throw new GateError("Approve the course plan first. Nothing is written until you do.");
  const has = db.select({ n: sql<number>`count(*)` }).from(s.layerPassages).where(eq(s.layerPassages.layerId, layerId)).get()!.n;
  if (!has) throw new StructureError("This layer has no text left in it, so there is nothing to refresh. Add files that cover it first.");
  if (layer.contentStatus === "ready") db.update(s.layers).set({ contentStatus: "stale" }).where(eq(s.layers.id, layerId)).run();
  await writeLayerContent(db, engine, layerId, { signal });
}

/** The layer's own passages in reading order, numbered from 1. Used to ground reviews and re-explanations. */
export function passagesOfLayer(db: Db, layerId: string): OrderedPassage[] {
  const { part } = loadLayer(db, layerId);
  return layerPassageList(db, layerId, new Map(readingOrder(db, part.projectId).map((p) => [p.passageId, p])));
}

export { loadLayer, layerRows, passageWeeks };
