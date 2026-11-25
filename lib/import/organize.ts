/**
 * Reading a course the way a person does: the AI reads the syllabus, the folder tree and each file's facts, and says what the course's
 * weeks are (in the course's own numbering, breaks listed apart) and what every file is (week, type, how sure, why). Code measures the
 * files (real word counts over the whole file), sends them, and checks the answer: every file labelled exactly once, every week inside
 * the course. A bad answer is sent back once with its problems listed; a second bad answer leaves the files unlabelled for the student
 * to label. A good answer then gets a final look over the whole result (`check` task): what doesn't make sense is fixed or marked
 * "check this", and code checks the changes the same way before using them. There are no fallback rules.
 */
import type { CourseCheck, CourseMapAnswer } from "@/lib/ai/schemas";
import type { Engine } from "@/lib/ai/engine";
import { EngineAborted, EngineError } from "@/lib/ai/errors";
import type { CourseBreak, KnownFile, KnownWeek, OrganizeFile, WeekTally } from "@/lib/ai/prompts/organize";
import { checkCourse, mapCourse, pickSyllabus } from "@/lib/ai/tasks";
import { COURSE_TYPES, TYPE_LABEL, type FileType } from "@/lib/projects/file-kinds";
import { KIND_LABEL } from "./kinds";
import { printedSpan } from "./printed-pages";
import { wordCount, type Block, type FileKind, type PageKind } from "./types";

/** What code measures about a file for the AI (see `measure`). */
export type MeasuredFile = Omit<OrganizeFile, "id" | "path">;

/** A file to label. `key` is whatever the caller uses to find it again (a file id, a path). `text` is its full text, needed only to send a syllabus in full. */
export interface FileToMap {
  key: string;
  relPath: string;
  facts: MeasuredFile;
  text?: string;
}

/** Pages of a file the syllabus assigns to one week, in the printed page numbers. */
export interface PageRange {
  week: number;
  from: number;
  to: number;
}

export interface FileLabel {
  week: number | null;
  type: FileType;
  check: boolean;
  reason: string;
  /** Only when the syllabus assigns different pages of this file to two or more weeks; otherwise empty. */
  pages: PageRange[];
}

export interface MappedWeek {
  week: number;
  date: string | null;
  title: string;
  kind: "class" | "no-class" | "exam";
  syllabus: string;
}

export type CourseMapResult =
  | {
      ok: true;
      courseCode: string | null;
      weeks: MappedWeek[];
      /** Breaks the syllabus doesn't number (a reading week), each after a numbered week. */
      breaks: CourseBreak[];
      labels: Map<string, FileLabel>;
      missingReadings: { week: number | null; reading: string }[];
      /** Keys of files the syllabus doesn't mention. */
      notInSyllabus: string[];
      /** Keys of the files read as the syllabus (their text was sent in full). */
      syllabusKeys: string[];
      /** What the final check said about the course as a whole, in plain sentences. */
      review: string[];
    }
  | { ok: false; message: string };

/** Plain-words steps, shown while the import runs. */
export type Progress = (step: string) => void;

const OPENING_WORDS = 1500;
/** Openings are cut shorter when a folder is very large, so the whole request stays a sensible size. */
const ALL_OPENINGS = 150_000;
const SYLLABUS_WORDS = 40_000;

/** The first `n` words of a text with its line breaks kept (a syllabus schedule or a table reads by its lines). */
const firstWords = (text: string, n: number) => {
  const re = /\S+/g;
  let end = 0;
  for (let i = 0; i < n; i++) {
    const m = re.exec(text);
    if (!m) return text.replace(/\n{3,}/g, "\n\n").trim();
    end = m.index + m[0].length;
  }
  const more = re.exec(text) !== null;
  return `${text.slice(0, end).replace(/\n{3,}/g, "\n\n").trim()}${more ? " …" : ""}`;
};

/** How many opening words each file gets: about 1,500, fewer when a folder is very large so the whole request stays a sensible size. */
export const openingBudget = (files: number) => Math.max(300, Math.min(OPENING_WORDS, Math.floor(ALL_OPENINGS / Math.max(1, files))));

/** What code measures about one file: its real size over the whole file, its headings and its opening words. */
export function measure(f: { kind: FileKind; pageKind: PageKind; pageCount: number; blocks: Block[]; author?: string | null; pageOffset?: number | null }, openingWords = OPENING_WORDS): MeasuredFile {
  const text = f.blocks.map((b) => b.text).join("\n");
  const words = wordCount(text);
  const pages = Math.max(1, f.pageCount);
  const headings = f.blocks
    .filter((b) => b.kind === "heading")
    .map((b) => b.text.replace(/\s+/g, " ").trim().slice(0, 120))
    .filter((h, i, all) => h && all.indexOf(h) === i)
    .slice(0, 30);
  return {
    format: KIND_LABEL[f.kind],
    author: f.author ?? null,
    pages,
    pageWord: f.pageKind === "slide" ? "slides" : f.pageKind === "virtual" ? "virtual pages of about 400 words" : "pages",
    printed: f.pageOffset ? printedSpan(pages, f.pageOffset) : null,
    words,
    wordsPerPage: Math.round(words / pages),
    headings,
    opening: firstWords(text, openingWords),
  };
}

/** A syllabus as sent in full: up to about 40,000 words. */
export const syllabusText = (blocks: Block[]) => firstWords(blocks.map((b) => b.text).join("\n"), SYLLABUS_WORDS);

/** Every folder and file name, indented: what a person sees when they open the folder. `marked` paths get " (NEW)". */
export function folderTree(paths: string[], marked = new Set<string>()): string {
  const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const p of [...paths].sort(natural.compare)) {
    const segs = p.split("/").filter(Boolean);
    segs.forEach((seg, depth) => {
      const at = segs.slice(0, depth + 1).join("/");
      if (seen.has(at)) return;
      seen.add(at);
      const isFile = depth === segs.length - 1;
      lines.push(`${"  ".repeat(depth)}${seg}${isFile ? (marked.has(p) ? " (NEW)" : "") : "/"}`);
    });
  }
  return lines.join("\n");
}

/** What is wrong with an answer, in sentences the AI can act on. Empty means it can be used. `ids` are the files it had to label. */
export function checkCourseMap(answer: CourseMapAnswer, ids: string[], opts: { courseWeeks?: number[]; spans?: Map<string, { from: number; to: number }> } = {}): string[] {
  const problems: string[] = [];
  const want = new Set(ids);
  const seen = new Map<string, number>();
  for (const f of answer.files) seen.set(f.file, (seen.get(f.file) ?? 0) + 1);
  const missing = ids.filter((id) => !seen.has(id));
  if (missing.length) problems.push(`These files have no entry: ${missing.join(", ")}. Label every file.`);
  const twice = [...seen].filter(([id, n]) => n > 1 && want.has(id)).map(([id]) => id);
  if (twice.length) problems.push(`These files have more than one entry: ${twice.join(", ")}. Give each file exactly one week and one type.`);
  const unknown = [...seen.keys()].filter((id) => !want.has(id));
  if (unknown.length) problems.push(`These ids are not files you were asked to label: ${unknown.join(", ")}.`);

  const weekNos = answer.weeks.map((w) => w.week);
  const repeated = weekNos.filter((w, i) => weekNos.indexOf(w) !== i);
  if (repeated.length) problems.push(`Week ${[...new Set(repeated)].join(", ")} is listed more than once. List each week once.`);
  const allowed = new Set(opts.courseWeeks ?? weekNos);
  const where = opts.courseWeeks ? "the course's existing weeks" : "the weeks you listed";
  for (const f of answer.files) {
    if (!want.has(f.file)) continue;
    if (f.week !== null && !allowed.has(f.week)) problems.push(`${f.file} is put in week ${f.week}, which is not one of ${where}.`);
    if (f.week === null && COURSE_TYPES.includes(f.type)) problems.push(`${f.file} is course material (${f.type}) but has no week. Give it the week it belongs to.`);
    if (f.type === "syllabus" && f.week !== null) problems.push(`${f.file} is the syllabus, so its week must be null.`);
  }
  problems.push(...checkPages(answer.files.filter((f) => want.has(f.file)), allowed, where, opts.spans));
  for (const b of answer.breaks) if (b.afterWeek !== 0 && !weekNos.includes(b.afterWeek)) problems.push(`The break "${b.title}" follows week ${b.afterWeek}, which is not one of the weeks you listed.`);
  const strays = answer.notInSyllabus.filter((id) => !want.has(id));
  if (strays.length) problems.push(`notInSyllabus lists ids that are not files you were asked to label: ${strays.join(", ")}.`);
  return [...new Set(problems)].slice(0, 12);
}

/** What is wrong with the page ranges of some files: weeks outside the course, ranges backwards or outside the file's pages. */
export function checkPages(files: { file: string; pages: PageRange[] }[], weeks: Set<number>, where: string, spans?: Map<string, { from: number; to: number }>): string[] {
  const problems: string[] = [];
  for (const f of files) {
    if (!f.pages.length) continue;
    const span = spans?.get(f.file);
    for (const r of f.pages) {
      if (!weeks.has(r.week)) problems.push(`${f.file} gives pages to week ${r.week}, which is not one of ${where}.`);
      if (r.to < r.from) problems.push(`${f.file} gives week ${r.week} pages ${r.from}-${r.to}, which run backwards.`);
      else if (span && (r.to < span.from || r.from > span.to)) problems.push(`${f.file} gives week ${r.week} pp. ${r.from}-${r.to}, but the file only has pp. ${span.from}-${span.to}. Use the printed page numbers in its facts.`);
    }
    if (new Set(f.pages.map((r) => r.week)).size < 2) problems.push(`${f.file} has "pages" for only one week. Give "pages" only when the syllabus assigns different pages of the file to two or more weeks; otherwise leave it empty.`);
  }
  return problems;
}

/** The course's files, read: the AI's first look finds the syllabus (unless it is given), then one call maps the whole course. */
export async function readCourse(
  engine: Engine,
  input: {
    course: string;
    files: FileToMap[];
    /** Every path of the folder, including files that are not sent to be labelled (copies, files the course already holds). */
    allPaths?: string[];
    /** For new files added later: the syllabus already stored, and the course's weeks and files. */
    known?: { syllabus: { path: string; text: string }[]; weeks: KnownWeek[]; files: KnownFile[] };
  },
  onProgress: Progress = () => {},
  signal?: AbortSignal,
): Promise<CourseMapResult> {
  const { files } = input;
  if (!files.length) return { ok: true, courseCode: null, weeks: [], breaks: [], labels: new Map(), missingReadings: [], notInSyllabus: [], syllabusKeys: [], review: [] };
  const listed: OrganizeFile[] = files.map((f, i) => ({ id: `F${i + 1}`, path: f.relPath, ...f.facts }));
  const keyOf = new Map(listed.map((l, i) => [l.id, files[i].key]));
  const ids = listed.map((l) => l.id);
  const spans = new Map(listed.map((l) => [l.id, l.printed ?? { from: 1, to: l.pages }]));
  const newPaths = new Set(files.map((f) => f.relPath));
  const tree = folderTree([...new Set([...(input.allPaths ?? []), ...newPaths])], input.known ? newPaths : undefined);

  try {
    let syllabus = input.known?.syllabus ?? [];
    let syllabusKeys: string[] = [];
    if (!input.known) {
      onProgress("Looking through the folder for the syllabus");
      const pick = await pickSyllabus(engine, { course: input.course, tree, files: listed }, signal);
      const picked = [...new Set(pick.syllabus)].filter((id) => keyOf.has(id));
      syllabusKeys = picked.map((id) => keyOf.get(id)!);
      syllabus = picked.map((id) => {
        const f = files[ids.indexOf(id)];
        return { path: f.relPath, text: firstWords(f.text ?? f.facts.opening, SYLLABUS_WORDS) };
      });
    }

    const courseWeeks = input.known?.weeks.map((w) => w.week);
    const known = input.known ? { weeks: input.known.weeks, files: input.known.files } : undefined;
    let feedback: string | undefined;
    let problems: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      onProgress(
        attempt === 0
          ? syllabus.length
            ? `Reading the syllabus and matching ${files.length === 1 ? "the file" : `all ${files.length} files`} to its weeks. This takes a minute or two.`
            : `There's no syllabus, so working out the weeks from the folder and the ${files.length === 1 ? "file" : `${files.length} files`}. This takes a minute or two.`
          : "Claude's answer had problems, so Margin is asking once more",
      );
      let answer: CourseMapAnswer;
      try {
        answer = await mapCourse(engine, { course: input.course, syllabus, tree, files: listed, known, feedback }, signal);
      } catch (e) {
        if (!(e instanceof EngineError) || e.code !== "BadStructuredOutput") throw e;
        problems = ["The answer did not match the required JSON shape."];
        feedback = problems.join(" ");
        continue;
      }
      onProgress("Checking Claude's answer against the files");
      problems = checkCourseMap(answer, ids, { courseWeeks: courseWeeks?.length ? courseWeeks : undefined, spans });
      if (problems.length) {
        feedback = problems.join(" ");
        console.log(`[margin ai] organize answer rejected: ${problems.length} problem(s)`);
        continue;
      }
      const final = input.known ? { answer, notes: [] } : await finalCheck(engine, { course: input.course, syllabus, tree, files: listed, ids, spans }, answer, onProgress, signal);
      const done = final.answer;
      const labels = new Map<string, FileLabel>();
      for (const f of done.files) labels.set(keyOf.get(f.file)!, { week: f.week, type: f.type, check: f.confidence === "check", reason: f.reason.trim(), pages: f.pages });
      return {
        ok: true,
        courseCode: done.courseCode?.trim() || null,
        weeks: input.known ? [] : [...done.weeks].sort((a, b) => a.week - b.week).map((w) => ({ ...w, title: w.title.trim(), syllabus: w.syllabus.trim() })),
        breaks: input.known ? [] : [...done.breaks].sort((a, b) => a.afterWeek - b.afterWeek).map((b) => ({ ...b, title: b.title.trim() })),
        labels,
        missingReadings: done.missingReadings,
        notInSyllabus: done.notInSyllabus.map((id) => keyOf.get(id)!),
        syllabusKeys,
        review: final.notes,
      };
    }
    return { ok: false, message: `Claude's answer didn't fit the files twice (${problems[0] ?? "it had the wrong shape"}), so Margin left the files unlabelled.` };
  } catch (e) {
    if (e instanceof EngineAborted || signal?.aborted) throw e instanceof EngineAborted ? e : new EngineAborted();
    if (e instanceof EngineError) return { ok: false, message: e.message };
    throw e;
  }
}

// ---------------------------------------------------------------- the final check

/** What code counts per week of a sorted answer, for the final check: how many files, how many words, which types, which folders. */
export function tallyWeeks(answer: CourseMapAnswer, files: OrganizeFile[]): WeekTally[] {
  const byId = new Map(files.map((f) => [f.id, f]));
  const folderOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "(top folder)");
  const count = (xs: string[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].map(([x, n]) => `${n} ${x}`).join(", ");
  return [...answer.weeks]
    .sort((a, b) => a.week - b.week)
    .map(({ week }) => {
      const here = answer.files.filter((f) => f.week === week).map((f) => ({ f, facts: byId.get(f.file) }));
      return {
        week,
        files: here.length,
        words: here.reduce((n, x) => n + (x.facts?.words ?? 0), 0),
        types: count(here.map((x) => TYPE_LABEL[x.f.type].toLowerCase())),
        folders: count(here.map((x) => folderOf(x.facts?.path ?? ""))),
      };
    });
}

/** The check's changes laid over the answer: lists it corrected replace the answer's, and each file it names takes its new label. */
export function applyCheck(answer: CourseMapAnswer, check: CourseCheck): { answer: CourseMapAnswer; fixed: number; flagged: number } {
  const changes = new Map(check.files.map((f) => [f.file, f]));
  let fixed = 0;
  let flagged = 0;
  const files = answer.files.map((f) => {
    const c = changes.get(f.file);
    if (!c) return f;
    if (c.week !== f.week || c.type !== f.type) fixed++;
    else if (c.confidence === "check" && f.confidence !== "check") flagged++;
    // a fix that gives no pages keeps the pages the file had
    return c.pages.length ? c : { ...c, pages: f.pages };
  });
  return { answer: { ...answer, weeks: check.weeks ?? answer.weeks, breaks: check.breaks ?? answer.breaks, missingReadings: check.missingReadings ?? answer.missingReadings, files }, fixed, flagged };
}

/**
 * A sharp teaching assistant's look over the whole sorted course: do the weeks match the folders and the syllabus, is any week empty or
 * overloaded, does any file's name or folder contradict its label, is anything in the syllabus unaccounted for? Its changes are checked
 * by code like the first answer (and must name only files that were sorted); changes that don't fit are sent back once with their
 * problems, and if they still don't fit they are not used and the first answer stands. If the check can't run at all (Claude is busy, the limit is reached), the first answer stands and the student is told.
 */
async function finalCheck(
  engine: Engine,
  ctx: { course: string; syllabus: { path: string; text: string }[]; tree: string; files: OrganizeFile[]; ids: string[]; spans: Map<string, { from: number; to: number }> },
  answer: CourseMapAnswer,
  onProgress: Progress,
  signal?: AbortSignal,
): Promise<{ answer: CourseMapAnswer; notes: string[] }> {
  onProgress("Looking over the whole result the way a teaching assistant would: weeks, folders and syllabus");
  const byId = new Map(ctx.files.map((f) => [f.id, f]));
  const shown = {
    course: ctx.course,
    syllabus: ctx.syllabus,
    tree: ctx.tree,
    weeks: [...answer.weeks].sort((a, b) => a.week - b.week),
    breaks: answer.breaks,
    tally: tallyWeeks(answer, ctx.files),
    files: answer.files.map((f) => ({ ...byId.get(f.file)!, week: f.week, type: f.type, confidence: f.confidence, reason: f.reason, pageRanges: f.pages })),
    missingReadings: answer.missingReadings,
    notInSyllabus: answer.notInSyllabus,
  };
  let feedback: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    let check: CourseCheck;
    try {
      check = await checkCourse(engine, { ...shown, feedback }, signal);
    } catch (e) {
      if (e instanceof EngineAborted || signal?.aborted || !(e instanceof EngineError)) throw e;
      if (e.code === "BadStructuredOutput" && attempt === 0) {
        feedback = "The answer did not match the required JSON shape.";
        continue;
      }
      console.log(`[margin ai] check skipped: ${e.code}`);
      onProgress("The final check couldn't run, so the sorting stays as first read");
      return { answer, notes: [`Margin's final check couldn't run (${e.message.replace(/\.$/, "")}), so the weeks and labels are as first read. Look over the files marked "check this".`] };
    }
    const unknown = check.files.filter((f) => !byId.has(f.file)).map((f) => f.file);
    const merged = applyCheck(answer, check);
    const problems = [...(unknown.length ? [`These ids are not files of this course: ${unknown.join(", ")}.`] : []), ...checkCourseMap(merged.answer, ctx.ids, { spans: ctx.spans })];
    if (problems.length) {
      console.log(`[margin ai] check changes rejected (${problems.length}): ${problems.join(" | ").slice(0, 400)}`);
      feedback = problems.join(" ");
      if (attempt === 0) onProgress("The final check's changes had problems, so Margin is asking once more");
      continue;
    }
    onProgress(summary(answer, check, merged));
    return { answer: merged.answer, notes: check.notes.map((n) => n.trim()).filter(Boolean) };
  }
  onProgress("The final check's changes didn't fit the files, so the sorting stays as first read");
  return { answer, notes: [] };
}

/** What the final check did, in a few plain words for the progress line. */
function summary(answer: CourseMapAnswer, check: CourseCheck, merged: { fixed: number; flagged: number }): string {
  const weeksChanged = !!check.weeks && check.weeks.length !== answer.weeks.length;
  const said = [
    weeksChanged ? `the course has ${check.weeks!.length} weeks, not ${answer.weeks.length}` : "",
    merged.fixed ? `fixed ${merged.fixed === 1 ? "1 file" : `${merged.fixed} files`}` : "",
    merged.flagged ? `marked ${merged.flagged} to check` : "",
  ].filter(Boolean);
  return said.length ? `The final check ${said.join(", ")}` : "The final check found nothing that doesn't make sense";
}
