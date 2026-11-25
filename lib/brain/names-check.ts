/**
 * Brains read before the stricter other-names rule (`sameThing` in `store.ts`, the alias rule in the `brain` prompt) are checked once, in
 * the background: some notes kept loose other names and merged two different things through them. The AI says which notes break the rule
 * and what each really holds; code checks every answer against the note's own names and files, then trims the other names and splits the
 * merged notes, each file's description going to the thing it is about. The migration that added the rule marked which courses to check.
 */
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Engine } from "@/lib/ai/engine";
import { BadStructuredOutput } from "@/lib/ai/errors";
import type { NameCheckNote } from "@/lib/ai/prompts";
import type { BrainNamesCheck } from "@/lib/ai/schemas";
import { checkOldBrainNames } from "@/lib/ai/tasks";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { rebuildLinks } from "./store";
import { nameKey } from "./words";

const KEY = "brain-names-check";
/** How many notes go into one call. */
const BATCH = 40;

/** Courses whose brain still needs the check. */
export function brainsToCheck(db: Db): string[] {
  return db.select({ p: s.uiState.projectId }).from(s.uiState).where(eq(s.uiState.key, KEY)).all().map((r) => r.p);
}

const markChecked = (db: Db, projectId: string) => db.delete(s.uiState).where(and(eq(s.uiState.projectId, projectId), eq(s.uiState.key, KEY))).run();

type Entry = BrainNamesCheck["notes"][number];

/** The notes worth a look, each with every file's description of it: those with other names, and those more than one file merged into. */
export function notesToCheck(db: Db, projectId: string): (NameCheckNote & { fileIds: string[] })[] {
  const notes = db.select().from(s.brainNotes).where(eq(s.brainNotes.projectId, projectId)).all().filter((n) => n.kind !== "reading");
  const mentions = db.select({ noteId: s.brainMentions.noteId, fileId: s.brainMentions.fileId, what: s.brainMentions.what }).from(s.brainMentions).where(eq(s.brainMentions.projectId, projectId)).all();
  const files = new Map(db.select({ id: s.files.id, name: s.files.name }).from(s.files).where(eq(s.files.projectId, projectId)).all().map((f) => [f.id, f.name]));
  const byNote = new Map<string, typeof mentions>();
  for (const m of mentions) byNote.set(m.noteId, [...(byNote.get(m.noteId) ?? []), m]);
  return notes
    .map((n) => {
      const ms = (byNote.get(n.id) ?? []).sort((a, b) => (files.get(a.fileId) ?? "").localeCompare(files.get(b.fileId) ?? ""));
      return { id: n.id, name: n.name, kind: n.kind, aliases: n.aliases, mentions: ms.map((m, i) => ({ n: i + 1, file: files.get(m.fileId) ?? "", what: m.what.slice(0, 400) })), fileIds: ms.map((m) => m.fileId) };
    })
    .filter((n) => n.mentions.length && (n.aliases.length > 0 || n.mentions.length > 1))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** What is wrong with one answer about one note, in sentences Claude can act on. Empty: it can be applied. Pure. */
export function entryProblems(e: Entry, note: NameCheckNote | undefined): string[] {
  if (!note) return [`"${e.note}" is not one of the notes listed.`];
  const own = new Set([note.name, ...note.aliases].map(nameKey));
  const out: string[] = [];
  const names = e.things.map((t) => nameKey(t.name));
  const foreign = e.things.flatMap((t) => [t.name, ...t.aliases]).filter((x) => !own.has(nameKey(x)));
  if (foreign.length) out.push(`${e.note}: ${foreign.map((x) => `"${x}"`).join(", ")} is not one of the note's names; use only its name and other names.`);
  if (new Set(names).size !== names.length) out.push(`${e.note}: two things have the same name.`);
  const given = e.things.flatMap((t) => t.mentions);
  const all = note.mentions.map((m) => m.n);
  const twice = given.filter((n, i) => given.indexOf(n) !== i);
  const missing = all.filter((n) => !given.includes(n));
  const unknown = given.filter((n) => !all.includes(n));
  if (twice.length || missing.length || unknown.length) out.push(`${e.note}: every description (1 to ${all.length}) goes to exactly one thing${missing.length ? `; ${missing.join(", ")} went nowhere` : ""}${twice.length ? `; ${[...new Set(twice)].join(", ")} went to two` : ""}${unknown.length ? `; ${unknown.join(", ")} don't exist` : ""}.`);
  return out;
}

/** Apply one checked answer: the note keeps the thing with its own name (or the first), trimmed to its true other names; every other thing becomes its own note and takes its files' descriptions with it. */
function apply(db: Db, projectId: string, note: NameCheckNote & { fileIds: string[] }, e: Entry): { split: boolean; trimmed: boolean } {
  const whatOf = (ms: number[]) => note.mentions.find((m) => m.n === ms[0])!.what;
  const keepAt = Math.max(0, e.things.findIndex((t) => nameKey(t.name) === nameKey(note.name)));
  const aliasesOf = (t: Entry["things"][number]) => [...new Set(t.aliases)].filter((a) => nameKey(a) !== nameKey(t.name));
  const was = db.select().from(s.brainNotes).where(eq(s.brainNotes.id, note.id)).get()!;
  const keep = e.things[keepAt];
  const kept = aliasesOf(keep);
  db.update(s.brainNotes)
    .set({ name: keep.name, aliases: kept, ...(e.things.length > 1 ? { what: whatOf(keep.mentions) } : {}) })
    .where(eq(s.brainNotes.id, note.id))
    .run();
  for (const [i, t] of e.things.entries()) {
    if (i === keepAt) continue;
    const id = nanoid(10);
    db.insert(s.brainNotes).values({ id, projectId, name: t.name, kind: was.kind as s.BrainKind, aliases: aliasesOf(t), what: whatOf(t.mentions) }).run();
    const fileIds = t.mentions.map((n) => note.fileIds[n - 1]);
    db.update(s.brainMentions).set({ noteId: id }).where(and(eq(s.brainMentions.noteId, note.id), inArray(s.brainMentions.fileId, fileIds))).run();
  }
  return { split: e.things.length > 1, trimmed: kept.length !== was.aliases.length || keep.name !== was.name };
}

/**
 * Check one course's brain, a batch of notes per call. An answer that breaks the rules above is sent back once with its problems; what
 * still doesn't fit is left as it was. Marked done once it has run, so it runs once per course. Throws what the engine throws (the usage
 * limit), so the caller can try again later.
 */
export async function checkBrainNamesOf(db: Db, engine: Engine, projectId: string, signal?: AbortSignal): Promise<{ split: number; trimmed: number }> {
  const project = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get();
  if (!project) return { split: 0, trimmed: 0 };
  const course = [project.courseCode, project.name].filter(Boolean).join(" · ");
  const all = notesToCheck(db, projectId);
  let split = 0;
  let trimmed = 0;
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH).map((n, k) => ({ ...n, id: `N${k + 1}`, realId: n.id }));
    const byId = new Map(batch.map((n) => [n.id, n]));
    let good: Entry[] = [];
    let feedback: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const got = await checkOldBrainNames(engine, { course, notes: batch.map(({ id, name, kind, aliases, mentions }) => ({ id, name, kind, aliases, mentions })), feedback }, signal);
        const seen = new Set<string>();
        const problems: string[] = [];
        good = [];
        for (const e of got.notes) {
          const p = seen.has(e.note) ? [`${e.note} is answered twice.`] : entryProblems(e, byId.get(e.note));
          seen.add(e.note);
          if (p.length) problems.push(...p);
          else good.push(e);
        }
        if (!problems.length) break;
        feedback = problems.slice(0, 10).join(" ");
      } catch (e) {
        if (!(e instanceof BadStructuredOutput)) throw e;
        feedback = "The answer did not match the required JSON shape.";
      }
    }
    db.transaction((tx) => {
      for (const e of good) {
        const n = byId.get(e.note)!;
        const r = apply(tx, projectId, { ...n, id: n.realId }, e);
        split += Number(r.split);
        trimmed += Number(r.trimmed);
      }
    });
  }
  rebuildLinks(db, projectId);
  markChecked(db, projectId);
  console.log(`[margin brain] ${projectId}: other names checked · ${split} note(s) split · ${trimmed} trimmed`);
  return { split, trimmed };
}
