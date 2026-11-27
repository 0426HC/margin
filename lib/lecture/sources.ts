import { asc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { searchPassages } from "@/lib/db/search";
import { passageWeeks } from "@/lib/layers/passage-weeks";
import { courseOrder } from "@/lib/layers/reading-order";
import { lectureFacts } from "./facts";
import type { LectureFacts, LectureSlide } from "./types";

/**
 * What one week's Lecture tab is written from, found by code: the week's lecture material and readings (a passage's week is
 * `passageWeeks`, so a file split by pages between weeks gives each week its own pages), the student's lecture notes for the week, and a
 * hash of each section's sources so a section is written again only when what it rests on changed.
 */

export interface WeekPassage {
  passageId: string;
  fileId: string;
  file: string;
  page: number;
  text: string;
  words: number;
}

export interface WeekSources {
  lecture: WeekPassage[];
  reading: WeekPassage[];
  /** The student's notes for the week, one line per block, as written ("# " a heading, "- " a bullet). Empty: no notes. */
  notes: string[];
  /** When the notes were last saved (ms), or null. */
  notesAt: number | null;
  hash: { notes: string | null; material: string | null };
}

const hashOf = (parts: unknown) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);

/** Every week of a course with lecture material, readings or notes, in one pass over the course. */
export function courseSources(db: Db, projectId: string): Map<number, WeekSources> {
  const weekOf = passageWeeks(db, projectId);
  const byWeek = new Map<number, { lecture: WeekPassage[]; reading: WeekPassage[] }>();
  for (const p of courseOrder(db, projectId)) {
    const w = weekOf.get(p.passageId);
    if (!w || !p.fileId) continue;
    const e = byWeek.get(w) ?? byWeek.set(w, { lecture: [], reading: [] }).get(w)!;
    (p.role === "lecture" ? e.lecture : e.reading).push({ passageId: p.passageId, fileId: p.fileId, file: p.file, page: p.page, text: p.text, words: p.words });
  }
  const pages = new Map(db.select().from(s.weekNotes).where(eq(s.weekNotes.projectId, projectId)).all().map((r) => [r.week, r]));
  const out = new Map<number, WeekSources>();
  for (const week of new Set([...byWeek.keys(), ...pages.keys()])) {
    const { lecture, reading } = byWeek.get(week) ?? { lecture: [], reading: [] };
    const page = pages.get(week);
    const notes = (page?.blocks ?? []).filter((b) => b.text.trim()).map((b) => (b.type === "heading" ? `# ${b.text.trim()}` : b.type === "bullet" ? `- ${b.text.trim()}` : b.text.trim()));
    // by content, not id: the same files read again (or the demo, whose ids are new each time) need nothing written again
    const material = [lecture, reading].map((list) => list.map((p) => `${p.file}\u0000${p.page}\u0000${p.text}`));
    out.set(week, {
      lecture,
      reading,
      notes,
      notesAt: notes.length ? (page?.updatedAt ?? null) : null,
      hash: { notes: notes.length ? hashOf([notes, material]) : null, material: lecture.length ? hashOf(material) : null },
    });
  }
  return out;
}

const EMPTY: WeekSources = { lecture: [], reading: [], notes: [], notesAt: null, hash: { notes: null, material: null } };
export const weekSources = (db: Db, projectId: string, week: number): WeekSources => courseSources(db, projectId).get(week) ?? EMPTY;

/** Whether the week has a Lecture tab at all: lecture material, or the student's notes. */
export const hasLectureTab = (src: Pick<WeekSources, "lecture" | "notes">) => src.lecture.length > 0 || src.notes.length > 0;

/** Lecture material as slides (or pages) with their structure, read from the sections' stored blocks, for counting (also by the exam room). */
export function slidesOf(db: Db, lecture: { fileId: string; file: string; page: number }[]): LectureSlide[] {
  const pages = new Map<string, { file: string; pages: Set<number> }>();
  for (const p of lecture) (pages.get(p.fileId) ?? pages.set(p.fileId, { file: p.file, pages: new Set() }).get(p.fileId)!).pages.add(p.page);
  const out: LectureSlide[] = [];
  for (const [fileId, { file, pages: wanted }] of pages) {
    const blocks = db.select({ original: s.sections.original }).from(s.sections).where(eq(s.sections.fileId, fileId)).orderBy(asc(s.sections.position)).all().flatMap((r) => r.original);
    const byPage = new Map<number, { heading: string | null; lines: string[] }>();
    for (const b of blocks) {
      if (!wanted.has(b.page)) continue;
      const slide = byPage.get(b.page) ?? byPage.set(b.page, { heading: null, lines: [] }).get(b.page)!;
      if (b.kind === "heading" && slide.heading === null) slide.heading = b.text;
      else slide.lines.push(...b.text.split("\n").map((l) => l.trim()).filter(Boolean));
    }
    for (const page of [...byPage.keys()].sort((a, b) => a - b)) out.push({ file, page, ...byPage.get(page)! });
  }
  return out;
}

/** The numbers counted from each lecture file of the week, by code. */
export function factsByFile(db: Db, lecture: WeekPassage[]): { file: string; facts: LectureFacts }[] {
  const slides = slidesOf(db, lecture);
  return [...new Set(lecture.map((p) => p.file))].map((file) => ({ file, facts: lectureFacts(slides.filter((x) => x.file === file)) }));
}

/** At most this many words of lecture material and of readings go into one prompt. */
export const LECTURE_WORDS = 30_000;
export const READING_WORDS = 15_000;
/** Passages a student's note line can pull from the week's readings and lecture material. */
const PER_LINE = 3;
const NOTES_CAP = 40;

/** The first passages up to a word budget, in course order. */
export function capWords<T extends { words: number }>(list: T[], budget: number): T[] {
  const out: T[] = [];
  let n = 0;
  for (const p of list) {
    if (n + p.words > budget && out.length) break;
    out.push(p);
    n += p.words;
  }
  return out;
}

/** In course order, whatever order they were found in. */
const inOrder = (all: WeekPassage[], ids: Set<string>) => all.filter((p) => ids.has(p.passageId));

/**
 * For the notes section: the passages of the week's readings and lecture material that the student's note lines are about, found by a word
 * search (BM25) for each line, so a short note can be expanded and pointed back to where the files cover it. Never AI retrieval.
 */
export function passagesForNotes(db: Db, projectId: string, src: WeekSources): WeekPassage[] {
  const pool = [...src.lecture, ...src.reading];
  const ids = pool.map((p) => p.passageId);
  if (!ids.length) return [];
  const found = new Set<string>();
  for (const line of src.notes) for (const hit of searchPassages(db, projectId, line.replace(/^[#-]\s*/, ""), PER_LINE, { passageIds: ids })) found.add(hit.passageId);
  return capWords(inOrder(pool, found), READING_WORDS + LECTURE_WORDS / 2).slice(0, NOTES_CAP);
}

const STOP = new Set("about after again also because been before being between both could does from have here into just like made make many more most much must only other over same should since some such than that their them then there these they this those through under very were what when where which while with would your slide slides lecture".split(" "));

/**
 * For the material section: the readings to compare the lecture with. All of them when they fit; otherwise the passages a word search
 * finds for the words the lecture uses most.
 */
export function readingsForMaterial(db: Db, projectId: string, src: WeekSources): WeekPassage[] {
  const total = src.reading.reduce((n, p) => n + p.words, 0);
  if (total <= READING_WORDS) return src.reading;
  const counts = new Map<string, number>();
  for (const p of src.lecture) for (const w of p.text.toLowerCase().match(/[a-z]{5,}/g) ?? []) if (!STOP.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  const query = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([w]) => w).join(" ");
  const hits = query ? searchPassages(db, projectId, query, 60, { passageIds: src.reading.map((p) => p.passageId) }) : [];
  return capWords(inOrder(src.reading, new Set(hits.map((h) => h.passageId))), READING_WORDS);
}
