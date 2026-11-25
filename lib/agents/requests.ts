import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { invalidCitations, stripInvalidCitations } from "@/lib/ai/citations";
import type { Engine } from "@/lib/ai/engine";
import { BadStructuredOutput } from "@/lib/ai/errors";
import { makeDocument } from "@/lib/ai/tasks";
import type { Passage } from "@/lib/ai/prompts";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { searchPassages } from "@/lib/db/search";
import { StructureError } from "@/lib/layers/service";
import { readingOrder } from "@/lib/layers/reading-order";
import { gatherCourse } from "@/lib/brain/ask";
import { namedScope, notesNamedIn } from "@/lib/brain/scope";
import { getNoteToSelf } from "@/lib/layers/note-to-self";
import { getNotepad } from "@/lib/talk/notepad";
import { failTask, finishTask, startTask, type AgentId } from "./tasks";
import type { AgentDocBlock, AgentDocument } from "./types";

/** The student can see the problem and fix it (HTTP 400). */
export class RequestError extends StructureError {}
/** Today's requests are used up (HTTP 400, with the reason in words). */
export class RequestLimitError extends RequestError {}

export const MAX_NOTE = 800;
export const dailyLimit = () => Math.max(1, Number(process.env.MARGIN_AGENT_REQUESTS_PER_DAY) || 8);

const NAME: Record<AgentId, string> = { explainer: "the Explainer", quizzer: "the Quizzer", examiner: "the Examiner", connector: "the Connector", librarian: "the Librarian" };

// ---------------------------------------------------------------- routing and refusing

const RULES: [Exclude<AgentId, "explainer">, RegExp][] = [
  ["examiner", /\b(checklist|essay plan|plan for|plan an|rubric|outline|marking|criteria|thesis|exam prep|revision plan)\b/gi],
  ["quizzer", /\b(quiz|test me|practice questions?|self-?test|questions? (on|about)|flash ?cards?)\b/gi],
  ["connector", /\b(connect|connections?|compare|relate|relationships?|link(s|ed)? between|themes?|timeline|how does .{0,40} (fit|build|lead))\b/gi],
  ["librarian", /\b(find|search|look up|locate|collect|gather|passages?|quotes?|where (does|do|is|are)|sources? (for|on|about))\b/gi],
];

/** Which agent a note goes to, by what it asks for. Study guides, summaries and explanations, and anything unclear, go to the Explainer. */
export function routeRequest(text: string): AgentId {
  let best: AgentId = "explainer";
  let top = 0;
  for (const [agent, re] of RULES) {
    const n = text.match(re)?.length ?? 0;
    if (n > top) {
      top = n;
      best = agent;
    }
  }
  return best;
}

const GRADED = [
  /\b(write|draft|do|complete|finish|answer|solve|produce|make)\b[^.?!]{0,40}\b(my|the|this|our)\b[^.?!]{0,30}\b(essay|assignment|homework|paper|response paper|reading response|take-?home|problem set|lab report|dissertation|quiz|midterm|final|exam|test)\b/i,
  /\b(graded|for (a )?(grade|marks)|hand(ed)? in|hand it in|submit(ted)?|turn(ed)? in)\b/i,
];
const OK_WORDS = /\b(checklist|plan|outline|practice|explain|summar|study guide|find|compare)\b/i;

/** A note that asks for work to be handed in for a grade. Margin doesn't write that; it says so kindly and offers what it can make instead. */
export function declineReason(text: string): { message: string; alternative: string } | null {
  if (!GRADED.some((re) => re.test(text))) return null;
  if (OK_WORDS.test(text) && !/\b(write|do|complete|answer)\b[^.?!]{0,20}\b(my|the)\b/i.test(text)) return null;
  return {
    message: "Margin can't write work that you hand in for a grade. That has to be yours.",
    alternative: `Make an essay plan checklist, built from my course files, for: ${text.replace(/\s+/g, " ").trim().slice(0, 160)}`,
  };
}

// ---------------------------------------------------------------- the daily limit

const dayKey = (now: Date) => `agent-requests:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

export function usedToday(db: Db, projectId: string, now = new Date()): number {
  const v = db.select({ v: s.uiState.value }).from(s.uiState).where(and(eq(s.uiState.projectId, projectId), eq(s.uiState.key, dayKey(now)))).get()?.v;
  return typeof v === "number" ? v : 0;
}
export const remainingToday = (db: Db, projectId: string, now = new Date()) => Math.max(0, dailyLimit() - usedToday(db, projectId, now));

function bump(db: Db, projectId: string, now = new Date()) {
  const key = dayKey(now);
  const n = usedToday(db, projectId, now) + 1;
  db.insert(s.uiState).values({ id: `${projectId}:${key}`, projectId, key, value: n }).onConflictDoUpdate({ target: [s.uiState.projectId, s.uiState.key], set: { value: n } }).run();
  // yesterday's counters are not needed any more
  db.delete(s.uiState).where(and(eq(s.uiState.projectId, projectId), sql`${s.uiState.key} like 'agent-requests:%'`, sql`${s.uiState.key} != ${key}`)).run();
}

// ---------------------------------------------------------------- making the document

const OWN_CAP = 7000;
/** The most words of named material (a week, a layer, a reading) one document is made from. */
export const SCOPE_WORDS = 60_000;

/** The student's own writing: saved write-ups and the notepad. */
function ownWriting(db: Db, projectId: string): Passage[] {
  const own: Passage[] = [];
  let used = 0;
  for (const part of getNoteToSelf(db, projectId)) {
    for (const e of [...part.layers, ...(part.synthesis ? [part.synthesis] : [])]) {
      const t = e.text.slice(0, 1400);
      if (used + t.length > OWN_CAP) break;
      used += t.length;
      own.push({ file: `Your write-up: ${e.title}`, page: 1, text: t });
    }
  }
  const pad = getNotepad(db, projectId).blocks.map((b) => b.text.trim()).filter(Boolean).join("\n").slice(0, 2500);
  if (pad) own.push({ file: "Your notepad", page: 1, text: pad });
  return own;
}

/** Passage ids → file, page and text, in course order; at most `cap` words, passages the brain's notes point at kept first when it is over. */
function scopePassages(db: Db, projectId: string, ids: string[], cap = SCOPE_WORDS): Passage[] {
  const want = new Set(ids);
  const all = readingOrder(db, projectId).filter((p) => want.has(p.passageId));
  const total = all.reduce((n, p) => n + p.words, 0);
  let keep = all;
  if (total > cap) {
    const noted = new Set(db.select({ ids: s.brainMentions.passageIds }).from(s.brainMentions).where(eq(s.brainMentions.projectId, projectId)).all().flatMap((r) => r.ids));
    const ranked = [...all].sort((a, b) => Number(noted.has(b.passageId)) - Number(noted.has(a.passageId)));
    const picked = new Set<string>();
    let words = 0;
    for (const p of ranked) {
      if (words + p.words > cap) continue;
      picked.add(p.passageId);
      words += p.words;
    }
    keep = all.filter((p) => picked.has(p.passageId));
  }
  return keep.map((p) => ({ file: p.file, page: p.page, text: p.text }));
}

/** The brain's notes on some passages: "name (kind): what it is", for the agent's context. */
function notesOn(db: Db, projectId: string, ids: string[], max = 40): string[] {
  const want = new Set(ids);
  const rows = db.select({ noteId: s.brainMentions.noteId, passageIds: s.brainMentions.passageIds }).from(s.brainMentions).where(eq(s.brainMentions.projectId, projectId)).all();
  const hit = [...new Set(rows.filter((r) => r.passageIds.some((p) => want.has(p))).map((r) => r.noteId))];
  if (!hit.length) return [];
  return db.select().from(s.brainNotes).where(inArray(s.brainNotes.id, hit.slice(0, 400))).all().slice(0, max).map((n) => `${n.name} (${n.kind}): ${n.what}`);
}

export interface AgentMaterial {
  /** What the note named ("Week 2"), or null when it named nothing in particular. */
  scope: string | null;
  passages: Passage[];
  /** The brain's notes on the material, for context (never cited). */
  notes: string[];
  /** Passages from elsewhere in the course, only for what the note asks beyond the named material. */
  others: Passage[];
  /** "I haven't finished reading Week 9 yet…" when part of it came from a word search. */
  line: string | null;
}

/**
 * What an agent makes a document from. A note that names a week, a layer or a reading gets that material directly: all of it (up to
 * SCOPE_WORDS), with the brain's notes on it, plus a little from the brain for anything else the note asks. A note that names material
 * the course doesn't have gets one sentence saying so, and nothing is made. Any other note gets what the brain finds for it, like a question
 * in Let's talk!. The student's own writing is always added.
 */
export async function materialFor(db: Db, engine: Engine, projectId: string, text: string, signal?: AbortSignal): Promise<AgentMaterial | { missing: string }> {
  const scope = namedScope(db, projectId, text);
  if (scope && !scope.found) return { missing: scope.message };
  const own = ownWriting(db, projectId);
  if (scope) {
    const passages = scopePassages(db, projectId, scope.passageIds);
    const inScope = new Set(scope.passageIds);
    const beyond = await gatherCourse(db, engine, projectId, { question: text }, { limit: 8, signal });
    const others = beyond.passages.filter((_, i) => !inScope.has(beyond.passageIds[i]));
    return { scope: scope.label, passages: [...passages, ...own], notes: notesOn(db, projectId, scope.passageIds), others, line: null };
  }
  const found = await gatherCourse(db, engine, projectId, { question: text }, { signal });
  return { scope: null, passages: [...found.passages, ...own], notes: found.notes.map((n) => `${n.name} (${n.kind}): ${n.what}`), others: [], line: found.line };
}

/**
 * The Librarian's document is made by code, with no AI call: the passages of what the note names (matched by its words within that
 * material), else the passages of the brain's notes the note names in so many words, else a word search. Verbatim, each with its file and page.
 */
function librarianDocument(db: Db, projectId: string, text: string): { title: string; blocks: AgentDocBlock[] } | { missing: string } | null {
  const scope = namedScope(db, projectId, text);
  if (scope && !scope.found) return { missing: scope.message };
  let hits: { file: string; page: number; text: string }[];
  if (scope) {
    const matched = searchPassages(db, projectId, text, 10, { passageIds: scope.passageIds });
    hits = matched.length ? matched : scopePassages(db, projectId, scope.passageIds, 2500).slice(0, 10);
  } else {
    const named = notesNamedIn(db, projectId, text);
    const ids = named.length ? db.select({ ids: s.brainMentions.passageIds }).from(s.brainMentions).where(inArray(s.brainMentions.noteId, named)).all().flatMap((r) => r.ids) : [];
    hits = ids.length ? scopePassages(db, projectId, [...new Set(ids)], 6000).slice(0, 10) : searchPassages(db, projectId, text, 10);
  }
  if (!hits.length) return null;
  const short = text.replace(/\s+/g, " ").trim().slice(0, 60);
  return { title: `Passages for: ${short}`, blocks: [{ type: "heading", text: scope ? `Passages from ${scope.label}` : "Passages from your files" }, ...hits.map((h): AgentDocBlock => ({ type: "paragraph", text: `${h.text} [${h.file}, p. ${h.page}]` }))] };
}

function finish(db: Db, id: string, taskId: string, status: "done" | "declined" | "failed", patch: { title?: string; content?: AgentDocBlock[]; note?: string }, result: string) {
  db.update(s.agentRequests).set({ status, title: patch.title ?? null, content: patch.content ?? null, note: patch.note ?? null, finishedAt: Date.now() }).where(eq(s.agentRequests.id, id)).run();
  if (status === "failed") failTask(db, taskId, result);
  else finishTask(db, taskId, result);
}

async function work(db: Db, engine: Engine, row: { id: string; projectId: string; agent: AgentId; text: string }, taskId: string, signal?: AbortSignal) {
  try {
    if (row.agent === "librarian") {
      const doc = librarianDocument(db, row.projectId, row.text);
      if (doc && "missing" in doc) return finish(db, row.id, taskId, "failed", { note: doc.missing }, "That material isn't in the course.");
      if (!doc) return finish(db, row.id, taskId, "failed", { note: "Margin found nothing in your files about that. Try different words." }, "Found nothing in your files for that note.");
      return finish(db, row.id, taskId, "done", { title: doc.title, content: doc.blocks }, `Made “${doc.title}”. It is in Ready for you.`);
    }
    const material = await materialFor(db, engine, row.projectId, row.text, signal);
    if ("missing" in material) return finish(db, row.id, taskId, "failed", { note: material.missing }, "That material isn't in the course.");
    const passages = [...material.passages, ...material.others];
    if (!passages.length) return finish(db, row.id, taskId, "failed", { note: "Margin found nothing in your files or your writing about that, so there is nothing to build from. Try different words." }, "Found nothing to build that from.");
    bump(db, row.projectId);
    const input = { agent: row.agent, request: row.text, scope: material.scope, passages: material.passages, others: material.others, notes: material.notes };
    let out = await makeDocument(engine, input, signal).catch((e) => {
      if (e instanceof BadStructuredOutput) return null;
      throw e;
    });
    const bad = (d: NonNullable<typeof out>) => d.blocks.flatMap((b) => (b.type === "paragraph" ? [b.text] : b.type === "bullets" ? b.items : [])).flatMap((t) => invalidCitations(t, passages));
    if (out && !out.declined && bad(out).length) {
      const retry = await makeDocument(engine, { ...input, request: `${row.text}\n\n(Your last answer cited sources that were not given: ${[...new Set(bad(out))].join(", ")}. Cite only the files and pages given.)` }, signal).catch(() => null);
      out = retry ?? out;
    }
    if (!out) return finish(db, row.id, taskId, "failed", { note: "Claude's answer couldn't be used this time. Try sending the note again." }, "Couldn't make that document.");
    if (out.declined) return finish(db, row.id, taskId, "declined", { note: `${out.declined.message} ${out.declined.alternative}` }, `Declined that note: ${out.declined.message}`);
    const clean = (t: string) => stripInvalidCitations(t, passages).text;
    const written: AgentDocBlock[] = out.blocks.map((b) => (b.type === "paragraph" ? { ...b, text: clean(b.text) } : b.type === "bullets" ? { ...b, items: b.items.map(clean) } : b));
    const blocks: AgentDocBlock[] = material.line ? [{ type: "paragraph", text: material.line }, ...written] : written;
    return finish(db, row.id, taskId, "done", { title: out.title, content: blocks }, `Made “${out.title}”. It is in Ready for you.`);
  } catch (e) {
    const note = e instanceof Error && e.message ? e.message : "Something went wrong on Margin's side.";
    return finish(db, row.id, taskId, "failed", { note }, "Couldn't make that document.");
  }
}

export type Submitted = { kind: "refused"; message: string; alternative: string } | { kind: "started"; id: string; agent: AgentId; done: Promise<void> };

/**
 * A note left for the agents. Margin routes it to the right agent and records the work (so the dining hall shows them busy and the result
 * is announced), then the agent makes the document from the student's own files and writing. Graded work is refused kindly before anything
 * is sent. A daily limit keeps the usage in check. `done` resolves when the document is ready (the route does not wait for it).
 */
export function submitRequest(db: Db, engine: Engine, projectId: string, rawText: string, signal?: AbortSignal): Submitted {
  const text = rawText.replace(/\s+/g, " ").trim();
  if (text.length < 4) throw new RequestError("Say what you would like the agents to make.");
  if (text.length > MAX_NOTE) throw new RequestError(`Keep the note under ${MAX_NOTE} characters.`);
  const no = declineReason(text);
  if (no) return { kind: "refused", ...no };
  const agent = routeRequest(text);
  if (agent !== "librarian" && remainingToday(db, projectId) <= 0) throw new RequestLimitError(`You have used today's ${dailyLimit()} notes for the agents. They come back tomorrow. The Librarian's passage searches are always free.`);
  const id = nanoid(10);
  db.insert(s.agentRequests).values({ id, projectId, agent, text }).run();
  const taskId = startTask(db, projectId, agent, "make-document", `${NAME[agent][0].toUpperCase()}${NAME[agent].slice(1)} is working on your note`);
  return { kind: "started", id, agent, done: work(db, engine, { id, projectId, agent, text }, taskId, signal) };
}

// ---------------------------------------------------------------- reading and deleting

export interface RequestRow {
  id: string;
  agent: AgentId;
  text: string;
  status: "running" | "done" | "declined" | "failed";
  title: string | null;
  note: string | null;
  createdAt: number;
}

/** Documents ready for the student, newest first, and requests still being made. */
export function listRequests(db: Db, projectId: string): { ready: RequestRow[]; open: RequestRow[]; remaining: number; limit: number } {
  const rows = db.select().from(s.agentRequests).where(eq(s.agentRequests.projectId, projectId)).orderBy(desc(s.agentRequests.createdAt), sql`rowid desc`).all();
  const pick = (r: (typeof rows)[number]): RequestRow => ({ id: r.id, agent: r.agent, text: r.text, status: r.status, title: r.title, note: r.note, createdAt: r.createdAt });
  return { ready: rows.filter((r) => r.status === "done").map(pick), open: rows.filter((r) => r.status !== "done").slice(0, 5).map(pick), remaining: remainingToday(db, projectId), limit: dailyLimit() };
}

export function getDocument(db: Db, id: string): (AgentDocument & { status: RequestRow["status"]; note: string | null; projectId: string }) | null {
  const r = db.select().from(s.agentRequests).where(eq(s.agentRequests.id, id)).get();
  return r ? { id: r.id, projectId: r.projectId, agent: r.agent, title: r.title ?? "", request: r.text, blocks: r.content ?? [], createdAt: r.createdAt, status: r.status, note: r.note } : null;
}

/** Delete a document (or a declined or failed note) for good. */
export function deleteRequest(db: Db, id: string): boolean {
  return db.delete(s.agentRequests).where(eq(s.agentRequests.id, id)).run().changes > 0;
}


