/**
 * Using the brain to answer: the AI picks the notes a question is about from the index of every note (names, other names, one line), code
 * adds the notes linked to them, and the real passages those notes point at are sent (about 25), with the reading notes of their files for
 * context. Weeks the brain hasn't read yet are searched by word (FTS5), and the answer says so in one line. The syllabus and optional
 * readings, which the brain doesn't read, are always searched by word too. Used by Let's talk!, the Note to Self chat and the agents.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Engine } from "@/lib/ai/engine";
import { BadStructuredOutput } from "@/lib/ai/errors";
import type { Passage } from "@/lib/ai/prompts";
import type { BrainIndexLine } from "@/lib/ai/prompts/brain";
import { pickBrainNotes } from "@/lib/ai/tasks";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { searchPassages } from "@/lib/db/search";
import { passageWeeks } from "@/lib/layers/passage-weeks";
import { courseFiles, weeksPhrase } from "./store";

/** About how many passages a question gets from the brain. */
export const BRAIN_PASSAGES = 25;
/** How many passages the word search adds for weeks not read yet, and for the syllabus and optional readings. */
const SEARCH_UNREAD = 6;
const SEARCH_OTHER = 3;
/** How many linked notes are added to the ones picked. */
const LINKED = 6;

export interface PickedNote {
  id: string;
  name: string;
  kind: string;
  what: string;
}

export interface Gathered {
  /** The real passages, in course order, each with its file and page. */
  passages: Passage[];
  passageIds: string[];
  /** The reading notes of the files those passages come from: each reading's argument and structure, for context. */
  readings: { file: string; text: string }[];
  /** The notes the question is about (picked, then linked). */
  notes: PickedNote[];
  /** Weeks not read yet that the word search drew from. */
  searchedWeeks: number[];
  /** "I haven't finished reading Week 9 yet, so this comes from a quick search.", or null. */
  line: string | null;
}

/** The one line an answer starts with when part of it comes from the word search, because the brain hasn't read those weeks yet. */
export const quickSearchLine = (weeks: number[]) => (weeks.length ? `I haven't finished reading ${weeksPhrase(weeks)} yet, so this comes from a quick search.` : null);

const firstSentence = (t: string, n = 110) => {
  const one = t.split(/(?<=[.!?])\s/)[0] ?? t;
  return one.length > n ? `${one.slice(0, n - 1).trimEnd()}…` : one;
};

/** The brain's index for one course: every note on a file it has read, with its other names, kind, weeks and one line. */
export function brainIndex(db: Db, projectId: string): { lines: BrainIndexLine[]; ids: Map<string, string> } {
  const course = new Set(courseFiles(db, projectId).map((f) => f.id));
  const notes = db.select().from(s.brainNotes).where(eq(s.brainNotes.projectId, projectId)).all();
  const mentions = db.select({ noteId: s.brainMentions.noteId, fileId: s.brainMentions.fileId, passageIds: s.brainMentions.passageIds }).from(s.brainMentions).where(eq(s.brainMentions.projectId, projectId)).all().filter((m) => course.has(m.fileId));
  const weekOf = passageWeeks(db, projectId);
  const weeks = new Map<string, Set<number>>();
  for (const m of mentions) for (const p of m.passageIds) if (weekOf.has(p)) weeks.set(m.noteId, (weeks.get(m.noteId) ?? new Set()).add(weekOf.get(p)!));
  const live = notes.filter((n) => mentions.some((m) => m.noteId === n.id));
  const ids = new Map<string, string>();
  const lines = live.map((n, i) => {
    const short = `N${i + 1}`;
    ids.set(short, n.id);
    return { id: short, name: n.name, aliases: n.aliases, kind: n.kind, line: firstSentence(n.what), weeks: weeksPhrase([...(weeks.get(n.id) ?? [])]) || "-" };
  });
  return { lines, ids };
}

/** Passage ids → file, page and text, for the prompt. */
function passageRows(db: Db, ids: string[]) {
  const out = new Map<string, Passage & { fileId: string }>();
  for (let i = 0; i < ids.length; i += 500)
    for (const r of db.select({ id: s.passages.id, page: s.passages.page, text: s.passages.text, file: s.files.name, fileId: s.files.id }).from(s.passages).innerJoin(s.files, eq(s.files.id, s.passages.fileId)).where(inArray(s.passages.id, ids.slice(i, i + 500))).all())
      out.set(r.id, { file: r.file, page: r.page, text: r.text, fileId: r.fileId });
  return out;
}

/** Every note's passages, picked notes first: one passage of each note in turn, so many notes are heard, until `limit`. Pure. */
export function roundRobin(lists: string[][], limit: number, taken: Set<string> = new Set()): string[] {
  const out: string[] = [];
  const queues = lists.map((l) => [...l]);
  while (out.length < limit && queues.some((q) => q.length)) {
    for (const q of queues) {
      while (q.length && taken.has(q[0])) q.shift();
      const next = q.shift();
      if (next === undefined) continue;
      taken.add(next);
      out.push(next);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** The reading notes of some files, by file id. */
export function readingNotes(db: Db, projectId: string, fileIds: string[]): Map<string, string> {
  if (!fileIds.length) return new Map();
  const rows = db
    .select({ fileId: s.brainMentions.fileId, what: s.brainMentions.what })
    .from(s.brainMentions)
    .innerJoin(s.brainNotes, eq(s.brainNotes.id, s.brainMentions.noteId))
    .where(and(eq(s.brainMentions.projectId, projectId), eq(s.brainNotes.kind, "reading"), inArray(s.brainMentions.fileId, fileIds)))
    .all();
  return new Map(rows.map((r) => [r.fileId, r.what]));
}

/** Notes with their passages, by note id. */
function notesWithPlaces(db: Db, projectId: string, ids: string[], course: Set<string>): Map<string, PickedNote & { passageIds: string[] }> {
  const out = new Map<string, PickedNote & { passageIds: string[] }>();
  if (!ids.length) return out;
  for (const n of db.select().from(s.brainNotes).where(inArray(s.brainNotes.id, ids)).all()) out.set(n.id, { id: n.id, name: n.name, kind: n.kind, what: n.what, passageIds: [] });
  for (const m of db.select().from(s.brainMentions).where(and(eq(s.brainMentions.projectId, projectId), inArray(s.brainMentions.noteId, ids))).all())
    if (course.has(m.fileId)) out.get(m.noteId)?.passageIds.push(...m.passageIds);
  return out;
}

/** Notes linked to these, strongest first, not counting the notes themselves. */
export function linkedNotes(db: Db, ids: string[], max = LINKED): string[] {
  if (!ids.length) return [];
  const rows = db.select().from(s.brainLinks).where(inArray(s.brainLinks.noteId, ids)).all().sort((a, b) => b.weight - a.weight);
  const have = new Set(ids);
  const out: string[] = [];
  for (const r of rows) if (!have.has(r.otherId) && !out.includes(r.otherId)) out.push(r.otherId);
  return out.slice(0, max);
}

/**
 * Find what a question needs from the course. `within` limits everything to some passages (an agent's named week or reading); `limit` is
 * how many passages the brain sends. Throws what the engine throws, except an answer of the wrong shape, which counts as no notes picked.
 */
export async function gatherCourse(
  db: Db,
  engine: Engine,
  projectId: string,
  ask: { question: string; context?: string; topic?: string },
  opts: { limit?: number; within?: Set<string>; signal?: AbortSignal } = {},
): Promise<Gathered> {
  const limit = opts.limit ?? BRAIN_PASSAGES;
  const project = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get();
  const courseName = [project?.courseCode, project?.name].filter(Boolean).join(" · ");
  const courseIds = courseFiles(db, projectId).map((f) => f.id);
  const course = new Set(courseIds);
  const read = new Set(db.select({ id: s.brainReads.fileId }).from(s.brainReads).where(and(eq(s.brainReads.projectId, projectId), eq(s.brainReads.status, "read"))).all().map((r) => r.id));
  const unread = courseIds.filter((id) => !read.has(id));
  const ok = (id: string) => !opts.within || opts.within.has(id);

  // the notes the question is about, then the notes linked to them
  const { lines, ids } = brainIndex(db, projectId);
  let picked: string[] = [];
  if (lines.length) {
    const question = ask.topic ? `${ask.question}\n(The student highlighted this passage: ${ask.topic.slice(0, 500)})` : ask.question;
    try {
      const got = await pickBrainNotes(engine, { course: courseName, question, context: ask.context, notes: lines }, opts.signal);
      picked = [...new Set(got.notes.map((x) => ids.get(x.trim())).filter((x): x is string => !!x))];
    } catch (e) {
      if (!(e instanceof BadStructuredOutput)) throw e;
    }
  }
  const linked = linkedNotes(db, picked);
  const notes = notesWithPlaces(db, projectId, [...picked, ...linked], course);
  const taken = new Set<string>();
  const fromPicked = roundRobin(picked.map((id) => (notes.get(id)?.passageIds ?? []).filter(ok)), Math.round(limit * 0.8), taken);
  const fromLinked = roundRobin(linked.map((id) => (notes.get(id)?.passageIds ?? []).filter(ok)), limit - fromPicked.length, taken);
  const chosen = [...fromPicked, ...fromLinked];

  // weeks not read yet: a quick word search, said in one line
  const query = ask.topic ? `${ask.topic.slice(0, 600)} ${ask.question}` : ask.context && ask.question.split(/\s+/).length < 6 ? `${ask.context} ${ask.question}` : ask.question;
  const scoped = opts.within ? { passageIds: [...opts.within] } : {};
  const quick = unread.length ? searchPassages(db, projectId, query, chosen.length ? SEARCH_UNREAD : SEARCH_UNREAD + 2, { fileIds: unread, ...scoped }).filter((h) => !taken.has(h.passageId)) : [];
  quick.forEach((h) => taken.add(h.passageId));
  const weekOf = passageWeeks(db, projectId);
  const searchedWeeks = [...new Set(quick.map((h) => weekOf.get(h.passageId)).filter((w): w is number => w !== undefined))].sort((a, b) => a - b);
  // read weeks that matched no note: still searched by word, so an exact phrase is never missed
  const plain = !chosen.length ? searchPassages(db, projectId, query, 8, { fileIds: courseIds.filter((id) => read.has(id)), ...scoped }).filter((h) => !taken.has(h.passageId)) : [];
  plain.forEach((h) => taken.add(h.passageId));
  // the syllabus and optional readings, which the brain doesn't read
  const others = opts.within ? [] : searchPassages(db, projectId, query, SEARCH_OTHER, { notFileIds: courseIds }).filter((h) => !taken.has(h.passageId));

  const order = new Map(db.select({ id: s.passages.id }).from(s.passages).where(eq(s.passages.projectId, projectId)).all().map((r, i) => [r.id, i]));
  const all = [...chosen, ...quick.map((h) => h.passageId), ...plain.map((h) => h.passageId), ...others.map((h) => h.passageId)];
  const rows = passageRows(db, all);
  const sorted = [...chosen, ...plain.map((h) => h.passageId)].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const ordered = [...sorted, ...quick.map((h) => h.passageId), ...others.map((h) => h.passageId)].filter((id) => rows.has(id));
  const files = [...new Set(ordered.map((id) => rows.get(id)!.fileId))];
  const reads = readingNotes(db, projectId, files);
  const nameOf = new Map(ordered.map((id) => [rows.get(id)!.fileId, rows.get(id)!.file]));
  return {
    passages: ordered.map((id) => {
      const r = rows.get(id)!;
      return { file: r.file, page: r.page, text: r.text };
    }),
    passageIds: ordered,
    readings: files.filter((f) => reads.has(f)).map((f) => ({ file: nameOf.get(f)!, text: reads.get(f)! })),
    notes: [...picked, ...linked].map((id) => notes.get(id)).filter((n): n is NonNullable<typeof n> => !!n).map((n) => ({ id: n.id, name: n.name, kind: n.kind, what: n.what })),
    searchedWeeks,
    line: quickSearchLine(searchedWeeks),
  };
}

/**
 * What the brain knows about a layer's passages: every note (not the readings themselves) that appears in them, the most-mentioned first,
 * and the reading notes of their files. Used for the Explained tab's Key concepts table.
 */
export function layerConcepts(db: Db, projectId: string, passageIds: string[]): { notes: { name: string; aliases: string[]; kind: string; what: string; passages: number }[]; readings: { file: string; text: string }[] } {
  const want = new Set(passageIds);
  const mentions = db.select({ noteId: s.brainMentions.noteId, fileId: s.brainMentions.fileId, passageIds: s.brainMentions.passageIds }).from(s.brainMentions).where(eq(s.brainMentions.projectId, projectId)).all();
  const hits = new Map<string, number>();
  const files = new Set<string>();
  for (const m of mentions) {
    const n = m.passageIds.filter((p) => want.has(p)).length;
    if (!n) continue;
    hits.set(m.noteId, (hits.get(m.noteId) ?? 0) + n);
    files.add(m.fileId);
  }
  const notes = hits.size ? db.select().from(s.brainNotes).where(inArray(s.brainNotes.id, [...hits.keys()].slice(0, 900))).all() : [];
  const reads = readingNotes(db, projectId, [...files]);
  const names = new Map(files.size ? db.select({ id: s.files.id, name: s.files.name }).from(s.files).where(inArray(s.files.id, [...files])).all().map((f) => [f.id, f.name]) : []);
  return {
    notes: notes
      .filter((n) => n.kind !== "reading")
      .sort((a, b) => (hits.get(b.id) ?? 0) - (hits.get(a.id) ?? 0))
      .map((n) => ({ name: n.name, aliases: n.aliases, kind: n.kind, what: n.what, passages: hits.get(n.id) ?? 0 })),
    readings: [...reads].map(([fileId, text]) => ({ file: names.get(fileId) ?? "", text })),
  };
}
