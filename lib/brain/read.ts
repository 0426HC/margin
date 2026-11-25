/**
 * Reading one course file into the brain: every passage of the file, numbered, goes to the AI (the `brain` task), which answers with
 * notes. Code checks every passage number against what was sent and maps it to the real passage (and so to the file and page); a note
 * whose numbers point at nothing is sent back once, then those numbers are dropped, and a note left with no passage is not kept. A very
 * long file is read in parts.
 */
import { asc, eq } from "drizzle-orm";
import type { Engine } from "@/lib/ai/engine";
import { BadStructuredOutput } from "@/lib/ai/errors";
import type { BrainNotesAnswer } from "@/lib/ai/schemas";
import { readFileForBrain } from "@/lib/ai/tasks";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { courseWeekTitles, weekName } from "@/lib/layers/week-names";
import { wordsOf } from "@/lib/layers/reading-order";
import { fileWeeks, markUnreadable, nameKey, saveFileNotes, type FileNote } from "./store";

/** About how many words go into one call. A longer file is read in parts of this size. */
export const PART_WORDS = 30_000;

interface FilePassage {
  id: string;
  page: number;
  text: string;
}

/** A file's passages in reading order. */
export function filePassages(db: Db, fileId: string): FilePassage[] {
  return db
    .select({ id: s.passages.id, page: s.passages.page, text: s.passages.text })
    .from(s.passages)
    .innerJoin(s.sections, eq(s.sections.id, s.passages.sectionId))
    .where(eq(s.passages.fileId, fileId))
    .orderBy(asc(s.sections.position), asc(s.passages.ordinal))
    .all();
}

/** The passages cut into parts of about PART_WORDS words each, in order. */
export function partsOf<T extends { text: string }>(passages: T[], max = PART_WORDS): T[][] {
  const parts: T[][] = [];
  let cur: T[] = [];
  let words = 0;
  for (const p of passages) {
    const w = wordsOf(p.text);
    if (cur.length && words + w > max) {
      parts.push(cur);
      cur = [];
      words = 0;
    }
    cur.push(p);
    words += w;
  }
  if (cur.length) parts.push(cur);
  return parts;
}

/** What is wrong with the passage numbers of an answer, for a retry. Empty when every number was sent. */
export function badNumbers(answer: BrainNotesAnswer, count: number): string[] {
  const out: string[] = [];
  for (const n of answer.notes) {
    const bad = n.passages.filter((x) => x < 1 || x > count);
    if (bad.length) out.push(`"${n.name}" points at passage${bad.length > 1 ? "s" : ""} ${bad.join(", ")}, but only 1 to ${count} were sent.`);
  }
  return out.slice(0, 10);
}

/**
 * Other names that can't be true: one that is the name of another note in the same answer (the brain wrote two notes, so they are two
 * things: klefts and armatoles), or one the note also lists as related (related things are links, never other names). Pure.
 */
export function trueAliases(answer: BrainNotesAnswer): string[][] {
  const names = answer.notes.map((n) => nameKey(n.name));
  return answer.notes.map((n, i) => {
    const related = new Set(n.related.map(nameKey));
    return n.aliases.filter((a) => {
      const k = nameKey(a);
      return k && k !== names[i] && !related.has(k) && !names.some((other, j) => j !== i && other === k);
    });
  });
}

/** An answer's notes with their numbers turned into real passages; numbers that point at nothing are dropped, and so is a note left with none (a reading note keeps the part's opening). */
export function toFileNotes(answer: BrainNotesAnswer, sent: FilePassage[]): FileNote[] {
  const out: FileNote[] = [];
  const aliases = trueAliases(answer);
  for (const [i, n] of answer.notes.entries()) {
    const ids = [...new Set(n.passages.filter((x) => x >= 1 && x <= sent.length).map((x) => sent[x - 1].id))];
    if (!ids.length && n.kind !== "reading") continue;
    out.push({ name: n.name, kind: n.kind, aliases: aliases[i], what: n.what, why: n.why, passageIds: ids.length ? ids : sent.slice(0, 3).map((p) => p.id), related: n.related });
  }
  return out;
}

/** Notes of a file read in parts: one reading note for the whole file (the first part's description, every part's passages). */
function joinParts(parts: FileNote[][]): FileNote[] {
  const all = parts.flat();
  const readings = all.filter((n) => n.kind === "reading");
  if (readings.length <= 1) return all;
  const first = readings[0];
  const reading = { ...first, passageIds: [...new Set(readings.flatMap((r) => r.passageIds))].slice(0, 40), related: [...new Set(readings.flatMap((r) => r.related))] };
  return [reading, ...all.filter((n) => n.kind !== "reading")];
}

/**
 * Read one file into the brain and store its notes. A file whose answer still doesn't fit the required shape after a retry is marked
 * unreadable (questions about it fall back to word search). Anything else the engine throws (the usage limit, a logged-out claude, a
 * cancel) is thrown, and the file stays unread so the queue comes back to it.
 */
export async function readIntoBrain(db: Db, engine: Engine, fileId: string, signal?: AbortSignal): Promise<{ notes: number }> {
  const file = db.select().from(s.files).where(eq(s.files.id, fileId)).get();
  if (!file) return { notes: 0 };
  const project = db.select().from(s.projects).where(eq(s.projects.id, file.projectId)).get()!;
  const passages = filePassages(db, fileId);
  if (!passages.length) {
    saveFileNotes(db, file.projectId, fileId, []);
    return { notes: 0 };
  }
  const weeks = fileWeeks(db, file.projectId).get(fileId) ?? [];
  const titles = courseWeekTitles(db, file.projectId);
  const course = [project.courseCode, project.name].filter(Boolean).join(" · ");
  const parts = partsOf(passages);
  const read: FileNote[][] = [];
  for (const [i, sent] of parts.entries()) {
    let feedback: string | undefined;
    let answer: BrainNotesAnswer | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const got = await readFileForBrain(
          engine,
          {
            course,
            file: file.name,
            week: weeks.length ? weeks.map((w) => weekName(w, titles.get(w))).join(" and ") : null,
            kind: file.role === "lecture" ? "lecture material" : "a reading",
            passages: sent.map((p, n) => ({ n: n + 1, file: file.name, page: p.page, text: p.text })),
            part: parts.length > 1 ? { n: i + 1, of: parts.length } : undefined,
            feedback,
          },
          signal,
        );
        answer = got;
        const bad = badNumbers(got, sent.length);
        if (!bad.length) break;
        feedback = `${bad.join(" ")} Use only the numbers of the passages given.`;
      } catch (e) {
        if (!(e instanceof BadStructuredOutput)) throw e;
        feedback = "The answer did not match the required JSON shape.";
      }
    }
    if (!answer) {
      markUnreadable(db, file.projectId, fileId);
      console.log(`[margin brain] ${fileId} not readable: the answer didn't fit twice`);
      return { notes: 0 };
    }
    read.push(toFileNotes(answer, sent));
  }
  const notes = joinParts(read);
  saveFileNotes(db, file.projectId, fileId, notes);
  return { notes: notes.length };
}
