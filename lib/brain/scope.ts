/**
 * What an agent's note names: a week ("a concept sheet for week 2"), a layer (by its title), or a reading (by its author or title). When a
 * note names one, the agent works from that material directly, all of it, not from a word search that may find other weeks. Code reads
 * the note; nothing here asks the AI.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { titleWords } from "@/lib/layers/duplicates";
import { passagesByWeek, partRows } from "@/lib/layers/service";
import { courseWeekCount } from "@/lib/weeks/count";
import { courseFiles, nameKey, weeksPhrase } from "./store";

export type Scope =
  | { found: true; label: string; passageIds: string[] }
  /** The note names material the course doesn't have: one plain sentence saying so. */
  | { found: false; message: string };

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14 };
const num = (t: string) => (/^\d+$/.test(t) ? Number(t) : (NUMBER_WORDS[t.toLowerCase()] ?? NaN));

/** The weeks a note names: "week 2", "wk 3", "weeks 2-4", "weeks 2 and 3", "class four". Pure. */
export function namedWeeks(text: string): number[] {
  const out = new Set<number>();
  const re = /\b(?:weeks?|wks?|class(?:es)?|lectures?)\.?\s*(\d{1,2}|[a-z]+)(?:\s*(?:-|–|to|and|&|,)\s*(\d{1,2}|[a-z]+))?/gi;
  for (const m of text.matchAll(re)) {
    const a = num(m[1]);
    if (!Number.isFinite(a)) continue;
    const b = m[2] !== undefined ? num(m[2]) : NaN;
    if (Number.isFinite(b) && b >= a && b - a < 15) for (let w = a; w <= b; w++) out.add(w);
    else out.add(a);
  }
  return [...out].sort((x, y) => x - y);
}

/** Words of a file name that can name it in a note: its author and title words, not "chapter", "week" or "notes". */
const GENERIC = new Set("chapter chapters reading readings notes note view page pages week lecture lectures slides read history modern introduction part".split(" "));
const nameTokens = (name: string) => [...titleWords(name.replace(/\.[a-z0-9]{1,5}$/i, ""))].filter((w) => w.length >= 4 && !GENERIC.has(w) && !/^\d+$/.test(w));
/** "chapter 2", "ch. 2", "chapter two": the chapter a name or a note gives, or null. */
const chapterOf = (t: string) => {
  const m = /\b(?:chapter|ch\.?)\s*(\d{1,2}|[a-z]+)\b/i.exec(t);
  const n = m ? num(m[1]) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** The course files a note names by author or title: the files sharing the most of its distinctive words (and its chapter, when it gives one). Pure. */
export function namedFiles(text: string, files: { id: string; name: string }[]): string[] {
  const said = new Set(titleWords(text));
  const df = new Map<string, number>();
  const tokens = files.map((f) => ({ f, t: nameTokens(f.name) }));
  for (const { t } of tokens) for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);
  // a word most files share names none of them
  const distinctive = (w: string) => (df.get(w) ?? 0) <= Math.max(1, Math.floor(files.length / 2));
  const chapter = chapterOf(text);
  const scored = tokens.map(({ f, t }) => ({ id: f.id, score: t.filter((w) => said.has(w) && distinctive(w)).length + (chapter !== null && chapterOf(f.name) === chapter ? 1 : 0), hit: t.some((w) => said.has(w) && distinctive(w)) }));
  const top = Math.max(0, ...scored.filter((x) => x.hit).map((x) => x.score));
  return top ? scored.filter((x) => x.hit && x.score === top).map((x) => x.id) : [];
}

/** The layers a note names by title (all of the title's meaningful words, at least two of them, are in the note). */
function namedLayers(db: Db, projectId: string, text: string): { id: string; title: string }[] {
  const said = new Set(titleWords(text));
  const layers = partRows(db, projectId).flatMap((p) => db.select({ id: s.layers.id, title: s.layers.title }).from(s.layers).where(and(eq(s.layers.partId, p.id), eq(s.layers.proposed, false))).all());
  return layers.filter((l) => {
    const w = [...titleWords(l.title)];
    return w.length >= 2 && w.every((x) => said.has(x));
  });
}

/**
 * The material a note names, or null when it names none. A week gives all of that week's course material; a layer all of its passages; a
 * reading all of that file's passages (only those of the named week, when it names both). A week outside the course, or a week with no
 * material, gives a plain sentence instead.
 */
export function namedScope(db: Db, projectId: string, text: string): Scope | null {
  const byWeek = passagesByWeek(db, projectId);
  const layers = namedLayers(db, projectId, text);
  if (layers.length) {
    const ids = db.select({ id: s.layerPassages.passageId }).from(s.layerPassages).where(inArray(s.layerPassages.layerId, layers.map((l) => l.id))).all().map((r) => r.id);
    if (ids.length) return { found: true, label: layers.map((l) => `the layer "${l.title}"`).join(" and "), passageIds: ids };
  }
  const weeks = namedWeeks(text);
  const files = courseFiles(db, projectId);
  const fileIds = namedFiles(text, files);
  const count = Math.max(courseWeekCount(db, projectId) ?? 0, ...byWeek.keys());
  if (weeks.length) {
    const outside = weeks.filter((w) => w < 1 || w > count);
    if (outside.length) return { found: false, message: `${weeksPhrase(outside)} ${outside.length > 1 ? "aren't" : "isn't"} part of this course, which has ${count} weeks, so there is nothing to make this from.` };
    const inWeeks = weeks.flatMap((w) => (byWeek.get(w) ?? []).map((p) => ({ id: p.passageId, fileId: p.fileId ?? "" })));
    if (!inWeeks.length) return { found: false, message: `${weeksPhrase(weeks)} has no readings or lecture material in your files yet, so there is nothing to make this from.` };
    const both = fileIds.length ? inWeeks.filter((p) => fileIds.includes(p.fileId)) : [];
    const name = (ids: string[]) => files.filter((f) => ids.includes(f.id)).map((f) => f.name).join(", ");
    if (both.length) return { found: true, label: `${name(fileIds)} in ${weeksPhrase(weeks)}`, passageIds: both.map((p) => p.id) };
    return { found: true, label: weeksPhrase(weeks), passageIds: inWeeks.map((p) => p.id) };
  }
  if (fileIds.length) {
    const ids = db.select({ id: s.passages.id }).from(s.passages).where(inArray(s.passages.fileId, fileIds)).all().map((r) => r.id);
    if (ids.length) return { found: true, label: files.filter((f) => fileIds.includes(f.id)).map((f) => f.name).join(", "), passageIds: ids };
  }
  return null;
}

/** Notes whose name or other names a note says in so many words ("the devşirme"), by id. Code only, for the Librarian. */
export function notesNamedIn(db: Db, projectId: string, text: string): string[] {
  const said = ` ${nameKey(text)} `;
  return db
    .select({ id: s.brainNotes.id, name: s.brainNotes.name, aliases: s.brainNotes.aliases, kind: s.brainNotes.kind })
    .from(s.brainNotes)
    .where(eq(s.brainNotes.projectId, projectId))
    .all()
    .filter((n) => n.kind !== "reading" && [n.name, ...n.aliases].map(nameKey).some((k) => k.length > 2 && said.includes(` ${k} `)))
    .map((n) => n.id);
}
