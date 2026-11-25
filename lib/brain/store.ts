/**
 * The course brain's store: notes on what matters in the course, merged across files, each pointing at the real passages where it
 * appears, and linked to the notes it goes with. Reading a file is `read.ts`; the order files are read in is `queue.ts`; using the brain
 * to answer a question is `ask.ts`.
 */
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import type { BrainKind } from "@/lib/db/schema";
import { pageRangeWeeks } from "@/lib/projects/page-ranges";
import { weekOfUnit } from "@/lib/updates/weeks";
import { nameKey } from "./words";
export { nameKey, weeksPhrase } from "./words";

/** A note on one file, checked by code: passages are real passage ids of that file. */
export interface FileNote {
  name: string;
  kind: BrainKind;
  aliases: string[];
  what: string;
  why: string;
  passageIds: string[];
  related: string[];
}

const keysOf = (n: { name: string; aliases: string[] }) => new Set([n.name, ...n.aliases].map(nameKey).filter((k) => k.length > 1));

/**
 * Two notes are the same thing only when they have the same name, or each gives the other's name as one of its other names. One side
 * naming the other is not enough: a loose other name ("Ipsilantis brothers" given for Kapodistrias) would make two things one note, and a
 * thing two files name differently staying as two notes does far less harm (both are found by name). Pure.
 */
export function sameThing(a: { name: string; aliases: string[] }, b: { name: string; aliases: string[] }): boolean {
  const an = nameKey(a.name);
  const bn = nameKey(b.name);
  if (an.length > 1 && an === bn) return true;
  return a.aliases.some((x) => nameKey(x) === bn) && b.aliases.some((x) => nameKey(x) === an);
}

/**
 * Store what the brain read in one file, replacing anything it read in that file before. A note about the same thing as a note the course
 * already has (`sameThing`, and not a reading) joins that note: this file's name for it becomes one more other name, and this file one more
 * place it appears. Every reading keeps a note of its own. Then the links are rebuilt and the file is marked read.
 */
export function saveFileNotes(db: Db, projectId: string, fileId: string, notes: FileNote[]) {
  db.transaction((tx) => {
    tx.delete(s.brainMentions).where(eq(s.brainMentions.fileId, fileId)).run();
    const existing = tx.select().from(s.brainNotes).where(eq(s.brainNotes.projectId, projectId)).all();
    const withPlaces = new Set(tx.select({ id: s.brainMentions.noteId }).from(s.brainMentions).where(eq(s.brainMentions.projectId, projectId)).all().map((r) => r.id));
    // notes no file mentions any more (this file's own, read before) are not merged into
    const pool = existing.filter((n) => withPlaces.has(n.id) && n.kind !== "reading");
    const mention = new Map<string, { what: string; why: string; passageIds: string[]; related: string[] }>();
    for (const note of notes) {
      let target = note.kind === "reading" ? undefined : pool.find((n) => sameThing(n, note));
      if (target) {
        const aliases = [...new Set([...target.aliases, note.name, ...note.aliases])].filter((a) => nameKey(a) !== nameKey(target!.name)).slice(0, 12);
        if (aliases.length !== target.aliases.length) tx.update(s.brainNotes).set({ aliases }).where(eq(s.brainNotes.id, target.id)).run();
        target.aliases = aliases;
      } else {
        const id = nanoid(10);
        const aliases = note.aliases.filter((a) => nameKey(a) !== nameKey(note.name));
        tx.insert(s.brainNotes).values({ id, projectId, name: note.name, kind: note.kind, aliases, what: note.what }).run();
        target = { id, projectId, name: note.name, kind: note.kind, aliases, what: note.what, createdAt: Date.now() };
        if (note.kind !== "reading") pool.push(target);
      }
      const had = mention.get(target.id);
      mention.set(target.id, had ? { ...had, passageIds: [...new Set([...had.passageIds, ...note.passageIds])], related: [...new Set([...had.related, ...note.related])] } : { what: note.what, why: note.why, passageIds: note.passageIds, related: note.related });
    }
    for (const [noteId, m] of mention) tx.insert(s.brainMentions).values({ noteId, fileId, projectId, ...m }).run();
    tx.insert(s.brainReads).values({ fileId, projectId, status: "read", notes: mention.size, readAt: Date.now() }).onConflictDoUpdate({ target: s.brainReads.fileId, set: { status: "read", notes: mention.size, readAt: Date.now() } }).run();
    pruneNotes(tx, projectId);
    rebuildLinks(tx, projectId);
  });
}

/** A file whose notes couldn't be read (Claude's answer didn't fit twice): marked, so the queue moves on; questions about it use word search. */
export function markUnreadable(db: Db, projectId: string, fileId: string) {
  db.insert(s.brainReads).values({ fileId, projectId, status: "failed", notes: 0, readAt: Date.now() }).onConflictDoUpdate({ target: s.brainReads.fileId, set: { status: "failed", notes: 0, readAt: Date.now() } }).run();
}

/** Notes that no file mentions any more (their files were removed) go. */
function pruneNotes(db: Db, projectId: string) {
  const live = new Set(db.select({ id: s.brainMentions.noteId }).from(s.brainMentions).where(eq(s.brainMentions.projectId, projectId)).all().map((r) => r.id));
  const dead = db.select({ id: s.brainNotes.id }).from(s.brainNotes).where(eq(s.brainNotes.projectId, projectId)).all().map((r) => r.id).filter((id) => !live.has(id));
  for (let i = 0; i < dead.length; i += 500) db.delete(s.brainNotes).where(inArray(s.brainNotes.id, dead.slice(i, i + 500))).run();
}

/** After files left the course (their places went with them): notes with no place left go, and the links are rebuilt. */
export function tidyBrain(db: Db, projectId: string) {
  pruneNotes(db, projectId);
  rebuildLinks(db, projectId);
}

/** How many links each note keeps: its strongest. */
const LINKS_PER_NOTE = 8;

/**
 * Rebuild the links between notes: two notes are linked when they appear in the same passages (more shared passages, a stronger link), or
 * when a reading names one as related to the other (counted as two shared passages). Reading notes are not linked this way: a reading
 * shares every passage with everything in it. Each note keeps its strongest links. Pure over the store.
 */
export function rebuildLinks(db: Db, projectId: string) {
  db.delete(s.brainLinks).where(eq(s.brainLinks.projectId, projectId)).run();
  const notes = db.select({ id: s.brainNotes.id, name: s.brainNotes.name, aliases: s.brainNotes.aliases, kind: s.brainNotes.kind }).from(s.brainNotes).where(eq(s.brainNotes.projectId, projectId)).all();
  const things = notes.filter((n) => n.kind !== "reading");
  const isThing = new Set(things.map((n) => n.id));
  const byKey = new Map<string, string>();
  for (const n of things) for (const k of keysOf(n)) if (!byKey.has(k)) byKey.set(k, n.id);
  const mentions = db.select({ noteId: s.brainMentions.noteId, passageIds: s.brainMentions.passageIds, related: s.brainMentions.related }).from(s.brainMentions).where(eq(s.brainMentions.projectId, projectId)).all();
  const weight = new Map<string, { w: number; named: boolean }>();
  const bump = (a: string, b: string, w: number, named: boolean) => {
    if (a === b) return;
    for (const [x, y] of [[a, b], [b, a]]) {
      const k = `${x}\u0000${y}`;
      const was = weight.get(k);
      weight.set(k, { w: (was?.w ?? 0) + w, named: (was?.named ?? false) || named });
    }
  };
  const atPassage = new Map<string, Set<string>>();
  for (const m of mentions) {
    if (!isThing.has(m.noteId)) continue;
    for (const p of m.passageIds) atPassage.set(p, (atPassage.get(p) ?? new Set()).add(m.noteId));
    for (const r of m.related) {
      const other = byKey.get(nameKey(r));
      if (other) bump(m.noteId, other, 2, true);
    }
  }
  for (const ids of atPassage.values()) {
    const list = [...ids];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) bump(list[i], list[j], 1, false);
  }
  const perNote = new Map<string, { other: string; w: number; named: boolean }[]>();
  for (const [k, v] of weight) {
    const [a, b] = k.split("\u0000");
    perNote.set(a, [...(perNote.get(a) ?? []), { other: b, ...v }]);
  }
  for (const [noteId, list] of perNote)
    for (const l of list.sort((x, y) => y.w - x.w).slice(0, LINKS_PER_NOTE)) db.insert(s.brainLinks).values({ projectId, noteId, otherId: l.other, why: l.named ? "named" : "together", weight: l.w }).run();
}

// ---------------------------------------------------------------- what the brain has read

/** The weeks of each course file: the week it is in, and the weeks its pages are split between. */
export function fileWeeks(db: Db, projectId: string): Map<string, number[]> {
  const units = new Map(db.select({ id: s.units.id, title: s.units.title }).from(s.units).where(eq(s.units.projectId, projectId)).all().map((u) => [u.id, u.title]));
  const split = pageRangeWeeks(db, projectId);
  const out = new Map<string, number[]>();
  for (const f of courseFiles(db, projectId)) {
    const own = f.week ?? (f.unitId ? weekOfUnit(units.get(f.unitId) ?? "") : null);
    out.set(f.id, [...new Set([...(own ? [own] : []), ...(split.get(f.id) ?? [])])].sort((a, b) => a - b));
  }
  return out;
}

/** The course's own material files (readings and lecture material), read and placed in a week. What the brain reads. */
export function courseFiles(db: Db, projectId: string) {
  return db
    .select({ id: s.files.id, name: s.files.name, week: s.files.week, unitId: s.files.unitId, role: s.files.role })
    .from(s.files)
    .where(and(eq(s.files.projectId, projectId), eq(s.files.category, "course"), eq(s.files.status, "done")))
    .all()
    .filter((f) => f.unitId !== null);
}

export interface BrainStatus {
  /** Weeks with course material, and those whose every file the brain has read. */
  weeksTotal: number;
  weeksRead: number;
  /** The weeks read, in order ("Knows Weeks 1-4 so far"). */
  readWeeks: number[];
  /** Weeks with a file not read yet. */
  unreadWeeks: number[];
  filesRead: number;
  filesTotal: number;
  /** Still reading: some course file isn't read yet. */
  building: boolean;
}

/** How far the brain has got with one course. A file Claude's answer couldn't be used for counts as finished (it falls back to word search). */
export function brainStatus(db: Db, projectId: string): BrainStatus {
  const weeksOf = fileWeeks(db, projectId);
  const done = new Set(db.select({ id: s.brainReads.fileId }).from(s.brainReads).where(eq(s.brainReads.projectId, projectId)).all().map((r) => r.id));
  const perWeek = new Map<number, { total: number; read: number }>();
  for (const [fileId, weeks] of weeksOf)
    for (const w of weeks) {
      const e = perWeek.get(w) ?? { total: 0, read: 0 };
      e.total++;
      if (done.has(fileId)) e.read++;
      perWeek.set(w, e);
    }
  const weeks = [...perWeek].sort((a, b) => a[0] - b[0]);
  const readWeeks = weeks.filter(([, e]) => e.read === e.total).map(([w]) => w);
  const filesRead = [...weeksOf.keys()].filter((id) => done.has(id)).length;
  return { weeksTotal: weeks.length, weeksRead: readWeeks.length, readWeeks, unreadWeeks: weeks.filter(([, e]) => e.read < e.total).map(([w]) => w), filesRead, filesTotal: weeksOf.size, building: filesRead < weeksOf.size };
}
