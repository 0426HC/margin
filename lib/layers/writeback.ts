import { and, asc, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Engine, StreamChunk } from "@/lib/ai/engine";
import { reexplainLayer, reviewLayerWriteback, reviewPartSynthesis } from "@/lib/ai/tasks";
import type { Review } from "@/lib/ai/schemas";
import { stripInvalidCitations } from "@/lib/ai/citations";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { searchPassages } from "@/lib/db/search";
import { layerCoversWriting, MIN_WORDING_KEPT, wordingKept, type SaveChoice, type SavedVersion } from "./loop";
import type { LayerState } from "./progress";
import { GateError, layerRows, loadLayer, passagesOfLayer, StructureError, targetStates } from "./service";

/** A write-back belongs to a layer or to a Part (its synthesis). Same loop, same tables. */
type Kind = "layer" | "part";
const now = () => Date.now();

export interface ThreadMessage {
  id: string;
  role: "user" | "assistant";
  kind: "writeback" | "review" | "dont_get_it" | "reexplain";
  content: string;
  /** For a review message: the structured review, so the pane can show Fixes, Your version cleaned up, So what and the verdict. */
  review: Review | null;
  /** For a review message: its write-back, and what the student answered to "Send to Note to Self?" (null until they answer). */
  writebackId: string | null;
  saveChoice: SaveChoice | null;
  createdAt: number;
}

export interface Thread {
  messages: ThreadMessage[];
  /** The last submitted write-back. */
  latestWritebackId: string | null;
  /** What Note to Self holds for this layer or Part now, and which version it is. */
  saved: { version: SavedVersion; text: string; writebackId: string } | null;
}

const latestOf = (db: Db, type: Kind, id: string) =>
  db.select().from(s.writebacks).where(and(eq(s.writebacks.targetType, type), eq(s.writebacks.targetId, id))).orderBy(desc(s.writebacks.createdAt), sql`rowid desc`).get();
const latestWriteback = (db: Db, layerId: string) => latestOf(db, "layer", layerId);

function threadOf(db: Db, type: Kind, id: string): Thread {
  const rows = db.select().from(s.layerMessages).where(and(eq(s.layerMessages.targetType, type), eq(s.layerMessages.targetId, id))).orderBy(asc(s.layerMessages.createdAt), sql`rowid`).all();
  const wbs = new Map(db.select({ id: s.writebacks.id, review: s.writebacks.review, saveChoice: s.writebacks.saveChoice }).from(s.writebacks).where(and(eq(s.writebacks.targetType, type), eq(s.writebacks.targetId, id))).all().map((w) => [w.id, w]));
  const saved = db.select({ version: s.noteSaves.version, text: s.noteSaves.text, writebackId: s.noteSaves.writebackId }).from(s.noteSaves).where(and(eq(s.noteSaves.targetType, type), eq(s.noteSaves.targetId, id))).get();
  return {
    messages: rows.map((m) => {
      const w = m.kind === "review" && m.writebackId ? wbs.get(m.writebackId) : undefined;
      return { id: m.id, role: m.role, kind: m.kind, content: m.content, review: w?.review ?? null, writebackId: m.writebackId, saveChoice: w?.saveChoice ?? null, createdAt: m.createdAt };
    }),
    latestWritebackId: latestOf(db, type, id)?.id ?? null,
    saved: saved ?? null,
  };
}

/** The layer chatbot's saved history, oldest first. */
export const getThread = (db: Db, layerId: string): Thread => threadOf(db, "layer", layerId);

const sayTo = (db: Db, type: Kind, id: string, role: "user" | "assistant", kind: ThreadMessage["kind"], content: string, writebackId?: string) =>
  db.insert(s.layerMessages).values({ id: nanoid(10), targetType: type, targetId: id, role, kind, writebackId: writebackId ?? null, content, createdAt: now() }).run();
const say = (db: Db, layerId: string, role: "user" | "assistant", kind: ThreadMessage["kind"], content: string, writebackId?: string) => sayTo(db, "layer", layerId, role, kind, content, writebackId);

/**
 * The answer to "Send to Note to Self?" for one review. "own" sends the student's writing as submitted, "refined" sends the cleaned-up
 * version, "no" sends nothing. Either "yes" replaces whatever was saved before for this layer or Part. "no" leaves an earlier save alone.
 */
function saveChoiceAs(db: Db, type: Kind, id: string, writebackId: string, choice: SaveChoice) {
  const wb = db.select().from(s.writebacks).where(and(eq(s.writebacks.id, writebackId), eq(s.writebacks.targetType, type), eq(s.writebacks.targetId, id))).get();
  if (!wb) throw new StructureError("That write-back is no longer here. Reload the page.");
  if (choice === "refined" && !wb.review) throw new StructureError("There is no cleaned-up version for that write-back.");
  db.transaction((tx) => {
    tx.update(s.writebacks).set({ saveChoice: choice }).where(eq(s.writebacks.id, writebackId)).run();
    if (choice === "no") return;
    tx.delete(s.noteSaves).where(and(eq(s.noteSaves.targetType, type), eq(s.noteSaves.targetId, id))).run();
    tx.insert(s.noteSaves).values({ id: nanoid(10), targetType: type, targetId: id, writebackId, version: choice, text: choice === "own" ? wb.text : wb.review!.cleanedUp, savedAt: now() }).run();
  });
}

/**
 * The student edits their saved write-up in the notebook. The saved text changes, and so does the text the layer's write-back pane shows
 * for that save (their submitted writing for "own", the cleaned-up version for "refined"), so it is one text everywhere. The version label stays.
 */
export function editSaved(db: Db, type: Kind, id: string, text: string): { version: SavedVersion; text: string } {
  const clean = text.replaceAll("->", "→");
  if (!clean.trim()) throw new StructureError("A saved write-up can't be empty. Edit it, or send a new version from the layer.");
  const saved = db.select().from(s.noteSaves).where(and(eq(s.noteSaves.targetType, type), eq(s.noteSaves.targetId, id))).get();
  if (!saved) throw new StructureError("Nothing is saved for this layer yet.");
  db.transaction((tx) => {
    tx.update(s.noteSaves).set({ text: clean }).where(eq(s.noteSaves.id, saved.id)).run();
    const wb = tx.select().from(s.writebacks).where(eq(s.writebacks.id, saved.writebackId)).get();
    if (!wb) return;
    if (saved.version === "own") {
      tx.update(s.writebacks).set({ text: clean }).where(eq(s.writebacks.id, wb.id)).run();
      tx.update(s.layerMessages).set({ content: clean }).where(and(eq(s.layerMessages.writebackId, wb.id), eq(s.layerMessages.kind, "writeback"))).run();
    } else if (wb.review) {
      tx.update(s.writebacks).set({ review: { ...wb.review, cleanedUp: clean } }).where(eq(s.writebacks.id, wb.id)).run();
    }
  });
  return { version: saved.version, text: clean };
}

/** What the model is shown: the layer's own passages first, plus project passages only when the writing leaves the layer. */
function groundingFor(db: Db, layerId: string, writing: string) {
  const { part } = loadLayer(db, layerId);
  const own = passagesOfLayer(db, layerId).map((p) => ({ file: p.file, page: p.page, text: p.text }));
  if (layerCoversWriting(writing, own.map((p) => p.text).join(" "))) return own;
  const seen = new Set(own.map((p) => `${p.file}|${p.page}|${p.text}`));
  const extra = searchPassages(db, part.projectId, writing.slice(0, 400), 4)
    .map((h) => ({ file: h.file, page: h.page, text: h.text }))
    .filter((p) => !seen.has(`${p.file}|${p.page}|${p.text}`));
  return [...own, ...extra];
}

function ready(db: Db, layerId: string) {
  const { layer, part } = loadLayer(db, layerId);
  if (part.breakdownStatus !== "approved") throw new GateError("Approve this Part's layers first, then write it back.");
  return layer;
}

/**
 * Submit a write-back. The text is saved exactly as written, the layer's chatbot reviews it against the course files, and
 * the reply (fixes, the student's version cleaned up, one so-what, a verdict for information) is saved to the layer's history.
 * Nothing reaches Note to Self until the student answers "Send to Note to Self?" (see saveWriteback).
 */
export async function submitWriteback(db: Db, engine: Engine, layerId: string, writing: string, signal?: AbortSignal) {
  const layer = ready(db, layerId);
  const text = writing.trim();
  if (!text) throw new StructureError("Write something first. Even a few sentences in your own words.");
  const prior = latestWriteback(db, layerId);
  const history = prior?.review ? { previousWriting: prior.text, previousFixes: prior.review.fixes.map((f) => f.text) } : {};
  const input = { layer: { title: layer.title, bigQuestion: layer.bigQuestion }, passages: groundingFor(db, layerId, text), writing: text, ...history };

  let { review, stripped } = await reviewLayerWriteback(engine, input, signal);
  if (wordingKept(text, review.cleanedUp) < MIN_WORDING_KEPT) ({ review, stripped } = await reviewLayerWriteback(engine, { ...input, strict: true }, signal));

  const writebackId = nanoid(10);
  db.insert(s.writebacks).values({ id: writebackId, targetType: "layer", targetId: layerId, text, review, createdAt: now() }).run();
  say(db, layerId, "user", "writeback", text, writebackId);
  say(db, layerId, "assistant", "review", review.verdict === "approved" ? "Approved." : "Not yet.", writebackId);
  return { writebackId, review, stripped, thread: getThread(db, layerId) };
}

/** The student's answer to "Send to Note to Self?" under a layer review. Makes no engine call. */
export function saveWriteback(db: Db, layerId: string, writebackId: string, choice: SaveChoice): Thread {
  ready(db, layerId);
  saveChoiceAs(db, "layer", layerId, writebackId, choice);
  return getThread(db, layerId);
}

/**
 * "I don't get it": explain again, more simply and from a lower level, then ask for another try. Streamed.
 * It never changes the layer's status. The finished reply is saved to the history.
 */
export async function* dontGetIt(db: Db, engine: Engine, layerId: string, confusion: string | undefined, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
  const layer = ready(db, layerId);
  const attempt = db.select({ n: sql<number>`count(*)` }).from(s.layerMessages).where(and(eq(s.layerMessages.targetType, "layer"), eq(s.layerMessages.targetId, layerId), eq(s.layerMessages.kind, "dont_get_it"))).get()!.n + 1;
  const writing = latestWriteback(db, layerId)?.text;
  const said = confusion?.trim() || undefined;
  const passages = groundingFor(db, layerId, [writing, said].filter(Boolean).join(" ") || layer.title);
  say(db, layerId, "user", "dont_get_it", said ?? "I don't get it");
  let reply = "";
  for await (const chunk of reexplainLayer(engine, { layer: { title: layer.title, bigQuestion: layer.bigQuestion }, passages, writing, confusion: said, attempt }, signal)) {
    if (chunk.type === "text") reply += chunk.delta;
    yield chunk;
  }
  say(db, layerId, "assistant", "reexplain", stripInvalidCitations(reply, passages).text);
}

// ---------------------------------------------------------------- the Part synthesis: the same loop, for one combined piece

const SYNTH_KIND = "part" as const;

function partOf(db: Db, partId: string) {
  const part = db.select().from(s.parts).where(eq(s.parts.id, partId)).get();
  if (!part) throw new StructureError("That Part no longer exists. Reload the page.");
  if (part.breakdownStatus !== "approved") throw new GateError("Approve this Part's layers first, then write its synthesis.");
  return part;
}

/** The question every synthesis answers. */
export const synthesisQuestion = (partTitle: string) => `How do the layers of ${partTitle} fit together into one argument?`;

/** The Part's layers with what the student sent to Note to Self, where there is anything. Unsaved layers are noted, never blocking. */
function layersWithSaved(db: Db, partId: string) {
  return layerRows(db, partId).map((l) => {
    const f = db.select({ text: s.noteSaves.text }).from(s.noteSaves).where(and(eq(s.noteSaves.targetType, "layer"), eq(s.noteSaves.targetId, l.id))).get();
    return { id: l.id, title: l.title, bigQuestion: l.bigQuestion, final: f?.text };
  });
}

const longWords = (t: string) => new Set((t.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).filter((w) => w.length >= 6));

/**
 * What the synthesis review is grounded in: the Part's own passages that share the most words with the writing, two per layer
 * at least so every layer is represented, then project-wide search only if the writing leaves the Part.
 */
function synthesisGrounding(db: Db, partId: string, projectId: string, writing: string) {
  const mine = longWords(writing);
  const score = (text: string) => [...longWords(text)].filter((w) => mine.has(w)).length;
  const picked: { file: string; page: number; text: string }[] = [];
  for (const l of layerRows(db, partId)) {
    const ranked = passagesOfLayer(db, l.id)
      .map((p) => ({ file: p.file, page: p.page, text: p.text, n: score(p.text) }))
      .sort((a, b) => b.n - a.n);
    picked.push(...ranked.slice(0, 2).map(({ file, page, text }) => ({ file, page, text })));
  }
  if (layerCoversWriting(writing, picked.map((p) => p.text).join(" "))) return picked;
  const seen = new Set(picked.map((p) => `${p.file}|${p.page}|${p.text}`));
  const extra = searchPassages(db, projectId, writing.slice(0, 400), 4)
    .map((h) => ({ file: h.file, page: h.page, text: h.text }))
    .filter((p) => !seen.has(`${p.file}|${p.page}|${p.text}`));
  return [...picked, ...extra];
}

export const getSynthesisThread = (db: Db, partId: string): Thread => threadOf(db, SYNTH_KIND, partId);

/** Where a Part's synthesis stands: the same rules as a layer. */
export const synthesisState = (db: Db, partId: string): LayerState => targetStates(db, SYNTH_KIND, [partId]).get(partId) ?? "not_saved";

/** Submit a synthesis: reviewed like a layer, grounded in the Part's passages and the layer writing the student saved. */
export async function submitSynthesis(db: Db, engine: Engine, partId: string, writing: string, signal?: AbortSignal) {
  const part = partOf(db, partId);
  const text = writing.trim();
  if (!text) throw new StructureError("Write something first. A few sentences that pull the layers together are enough to start.");
  const prior = latestOf(db, SYNTH_KIND, partId);
  const history = prior?.review ? { previousWriting: prior.text, previousFixes: prior.review.fixes.map((f) => f.text) } : {};
  const input = { part: part.key, layers: layersWithSaved(db, partId), passages: synthesisGrounding(db, partId, part.projectId, text), writing: text, ...history };

  let { review, stripped } = await reviewPartSynthesis(engine, input, signal);
  if (wordingKept(text, review.cleanedUp) < MIN_WORDING_KEPT) ({ review, stripped } = await reviewPartSynthesis(engine, { ...input, strict: true }, signal));

  const writebackId = nanoid(10);
  db.insert(s.writebacks).values({ id: writebackId, targetType: SYNTH_KIND, targetId: partId, text, review, createdAt: now() }).run();
  sayTo(db, SYNTH_KIND, partId, "user", "writeback", text, writebackId);
  sayTo(db, SYNTH_KIND, partId, "assistant", "review", review.verdict === "approved" ? "Approved." : "Not yet.", writebackId);
  return { writebackId, review, stripped, thread: getSynthesisThread(db, partId) };
}

/** The answer to "Send to Note to Self?" under a synthesis review. */
export function saveSynthesis(db: Db, partId: string, writebackId: string, choice: SaveChoice): Thread {
  partOf(db, partId);
  saveChoiceAs(db, SYNTH_KIND, partId, writebackId, choice);
  return getSynthesisThread(db, partId);
}

/** "I don't get it" on a synthesis: explain again how the Part's layers connect, more simply. Never changes the state. */
export async function* dontGetItSynthesis(db: Db, engine: Engine, partId: string, confusion: string | undefined, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
  const part = partOf(db, partId);
  const attempt = db.select({ n: sql<number>`count(*)` }).from(s.layerMessages).where(and(eq(s.layerMessages.targetType, SYNTH_KIND), eq(s.layerMessages.targetId, partId), eq(s.layerMessages.kind, "dont_get_it"))).get()!.n + 1;
  const writing = latestOf(db, SYNTH_KIND, partId)?.text;
  const said = confusion?.trim() || undefined;
  const passages = synthesisGrounding(db, partId, part.projectId, [writing, said, ...layersWithSaved(db, partId).map((l) => l.title)].filter(Boolean).join(" "));
  sayTo(db, SYNTH_KIND, partId, "user", "dont_get_it", said ?? "I don't get it");
  let reply = "";
  for await (const chunk of reexplainLayer(engine, { layer: { title: `${part.title} synthesis`, bigQuestion: synthesisQuestion(part.title) }, passages, writing, confusion: said, attempt }, signal)) {
    if (chunk.type === "text") reply += chunk.delta;
    yield chunk;
  }
  sayTo(db, SYNTH_KIND, partId, "assistant", "reexplain", stripInvalidCitations(reply, passages).text);
}
