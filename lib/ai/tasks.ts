import { stripInvalidCitations, invalidCitations, type SentPassage } from "./citations";
import { modelFor, type Task } from "./config";
import type { AiRequest, Engine, StreamChunk } from "./engine";
import { checkBrainNames, checkSorting, pageRangesOfCopies, readForBrain, pickNotes, collectSources, explainLayer, explainMissing, fixSection, findSyllabus, organizeCourse, filterNotes, weekLayers, pickSource, placeMaterial, professor, quickNotes, reexplain, reviewSynthesis, reviewWriteback, writeLecture, readExamSheet, updateExamDetails, writeExamQuestions, examineAnswers, makeAgentDocument } from "./prompts";
import type { Passage, PromptPair } from "./prompts";
import { checkExplained, cleanExplained, reportIsClean, type LayerNote } from "@/lib/layers/explained-check";
import { readExplained, readSection, sectionText } from "@/lib/layers/explained-text";
import { nameKey } from "@/lib/brain/words";
import { BadStructuredOutput } from "./errors";
import { brainNamesCheckSchema, brainNotesSchema, notePickSchema, agentDocumentSchema, classNotesPickSchema, courseCheckSchema, courseMapSchema, pageRangesSchema, syllabusPickSchema, examFeedbackSchema, examQuestionsSchema, examSummarySchema, explainMissingSchema, explainedSchema, layerBreakdownSchema, lectureWritingSchema, pickSourceSchema, placementSchema, reviewSchema, talkSourcesSchema, type ExplainedOut, type LectureWriting, type Review } from "./schemas";

// Each function binds one prompt, its Zod schema and the model for its task. Components and routes call these, never an engine directly.
const req = (task: Task, pair: PromptPair, label: string = task): AiRequest => ({ ...pair, ...modelFor(task), task: label });

/** Import, first look: which files are the syllabus. Uses the `organize` model (Opus 5.5 at medium effort by default). */
export const pickSyllabus = (e: Engine, input: Parameters<typeof findSyllabus>[0], signal?: AbortSignal) => e.json(req("organize", findSyllabus(input), "organize-syllabus"), syllabusPickSchema, signal);
/** Import: the course's weeks and every file's week, type, how sure and why. Checked by `lib/import/organize.ts`. */
export const mapCourse = (e: Engine, input: Parameters<typeof organizeCourse>[0], signal?: AbortSignal) => e.json(req("organize", organizeCourse(input)), courseMapSchema, signal);
/** Import, last step: a sharp teaching assistant's look over the whole sorted course (Opus at low effort by default). Checked again by code. */
export const checkCourse = (e: Engine, input: Parameters<typeof checkSorting>[0], signal?: AbortSignal) => e.json(req("check", checkSorting(input)), courseCheckSchema, signal);
/** Courses imported before the page-range rule: which files saved in several folders the syllabus splits by page between weeks (the `check` model). */
export const readPageRanges = (e: Engine, input: Parameters<typeof pageRangesOfCopies>[0], signal?: AbortSignal) => e.json({ ...req("check", pageRangesOfCopies(input), "check-pages"), priority: "background" }, pageRangesSchema, signal);
/** The layers of one week: its chain of ideas, read from the week's full text. Uses the `structure` model (Opus 5.5 at medium effort by default). */
export const proposeWeekLayers = (e: Engine, input: Parameters<typeof weekLayers>[0], signal?: AbortSignal) => e.json(req("structure", weekLayers(input)), layerBreakdownSchema, signal);
/** New files added to a course: which layer each passage joins, or a new layer for a new topic. The student approves new layers. */
export const placeNewMaterial = (e: Engine, input: Parameters<typeof placeMaterial>[0], signal?: AbortSignal) => e.json(req("structure", placeMaterial(input)), placementSchema, signal);
export const pickLayerSource = (e: Engine, input: Parameters<typeof pickSource>[0], signal?: AbortSignal, call: CallOptions = {}) => e.json({ ...req("explain", pickSource(input), "source"), ...call }, pickSourceSchema, signal);

/** How a layer's calls run: "now" or "background" (which may change while they wait), and who hears that Claude is still sending. */
export type CallOptions = Pick<AiRequest, "priority" | "onActivity">;

/** The Explained text read into its parts and checked for its shape, or what is wrong with it (no sections, say). */
function shapeOf(text: string): { out: ExplainedOut } | { problem: string } {
  const parsed = explainedSchema.safeParse(readExplained(text));
  return parsed.success ? { out: parsed.data } : { problem: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") };
}

/**
 * Named things the readings discuss that the sections don't explain: one call says, for each, the section where it matters and the
 * sentences that explain it there; code adds them at the end of that section. Nothing else changes. Additions that name a section that
 * doesn't exist, or a thing that wasn't asked about, are dropped.
 */
export async function explainMissingConcepts(
  e: Engine,
  input: { layer: { title: string; bigQuestion: string }; explained: ExplainedOut; missing: LayerNote[]; passages: Passage[] },
  signal?: AbortSignal,
  call: CallOptions = {},
): Promise<ExplainedOut> {
  if (!input.missing.length) return input.explained;
  const sections = input.explained.sections.map((s, i) => ({ n: i + 1, question: s.question, text: sectionText(s).replace(/^## [^\n]*\n\n/, "") }));
  const answer = await e.json({ ...req("explain", explainMissing({ layer: input.layer, sections, missing: input.missing, passages: input.passages }), "explain-missing"), ...call }, explainMissingSchema, signal);
  const asked = new Set(input.missing.map((n) => nameKey(n.name)));
  const out = input.explained.sections.map((s) => ({ ...s, blocks: [...s.blocks] }));
  let added = 0;
  for (const a of answer.additions) {
    const target = out[a.section - 1];
    if (!target || !asked.has(nameKey(a.name))) continue;
    target.blocks.push({ type: "paragraph", text: a.text.trim() });
    added++;
  }
  console.log(`[margin ai] explain: ${added} of ${input.missing.length} unexplained name(s) added to their sections`);
  return { ...input.explained, sections: out };
}

/**
 * Write the Explained tab, streamed: `onText` gets the whole text so far as Claude writes it, so the page shows it section by section.
 * Then code checks it part by part (`lib/layers/explained-check.ts`) and writes again only what failed, all at once: a section citing a
 * source that wasn't sent or citing nothing is written again on its own; a length far from its share rewrites only the longest (or
 * shortest) sections; a named thing the readings discuss that no section explains is added to the section where it matters. One round,
 * never the whole Explained again; then citations still pointing at nothing are stripped and lone citations folded in. Only a text that
 * can't be read as an Explained at all (no sections) is written again whole, once. `onStage` is told when checking and fixing start.
 * Without brain notes (its files not read yet) the named-things check is left for later (`conceptsChecked` false).
 */
export async function writeExplained(
  e: Engine,
  input: Parameters<typeof explainLayer>[0],
  { signal, onText, onStage, call = {} }: { signal?: AbortSignal; onText?: (text: string) => void; onStage?: (stage: "checking" | "fixing") => void; call?: CallOptions } = {},
): Promise<{ explained: ExplainedOut; fixed: number; conceptsChecked: boolean }> {
  const sent = input.passages;
  const base = { ...req("explain", explainLayer(input)), ...call };
  let out: ExplainedOut | null = null;
  for (let attempt = 0; attempt < 2 && !out; attempt++) {
    let text = "";
    for await (const chunk of e.stream(attempt ? { ...base, prompt: `${base.prompt}\n\nYour last answer could not be read: follow the format exactly, with "# Summary", "## " sub-question headings and "# So what".` } : base, signal)) {
      if (chunk.type !== "text") continue;
      text += chunk.delta;
      onText?.(text);
    }
    const shape = shapeOf(text);
    if ("out" in shape) out = shape.out;
    else console.log(`[margin ai] explain: the text had no usable shape (${shape.problem})${attempt ? "" : "; written again once"}`);
  }
  if (!out) throw new BadStructuredOutput("The explanation came back without its sections twice.");
  onStage?.("checking");
  const report = checkExplained(out, { sent, notes: input.notes, length: input.length });
  if (reportIsClean(report)) return { explained: cleanExplained(out, sent), fixed: 0, conceptsChecked: input.notes.length > 0 };
  onStage?.("fixing");
  const whole = [`# Summary`, out.summary, ...out.sections.map(sectionText), `# So what`, out.soWhat].join("\n\n");
  const first = out;
  // the sections written again and the missing names placed, side by side; the additions go at the end of their section either way
  const [rewritten, withAdditions] = await Promise.all([
    Promise.all(
      report.sections.map(async ({ index, problems, words }) => {
        const s = first.sections[index];
        const pair = fixSection({ layer: input.layer, explained: whole, section: sectionText(s), problems, passages: sent, words });
        return { index, section: readSection(await e.complete({ ...req("explain", pair, "explain-fix"), ...call }, signal), s.question) };
      }),
    ),
    explainMissingConcepts(e, { layer: input.layer, explained: first, missing: report.missing, passages: sent }, signal, call),
  ]);
  const fixed: ExplainedOut = {
    ...first,
    sections: first.sections.map((s, i) => {
      const base = rewritten.find((r) => r.index === i)?.section ?? s;
      return { ...base, blocks: [...base.blocks, ...withAdditions.sections[i].blocks.slice(s.blocks.length)] };
    }),
  };
  console.log(`[margin ai] explain: ${report.sections.length} section(s) written again, ${report.missing.length} unexplained name(s)`);
  return { explained: cleanExplained(fixed, sent), fixed: report.sections.length + report.missing.length, conceptsChecked: input.notes.length > 0 };
}

/** Citations in a review that were not in the passages sent are stripped, never shown as links. */
export function sanitizeReview(review: Review, sent: SentPassage[]): { review: Review; stripped: string[] } {
  const stripped: string[] = [];
  const clean = (t: string) => {
    const r = stripInvalidCitations(t, sent);
    stripped.push(...r.stripped);
    return r.text;
  };
  return {
    review: { ...review, fixes: review.fixes.map((f) => ({ ...f, text: clean(f.text) })), cleanedUp: clean(review.cleanedUp), soWhat: clean(review.soWhat) },
    stripped: [...new Set(stripped)],
  };
}

export async function reviewLayerWriteback(e: Engine, input: Parameters<typeof reviewWriteback>[0], signal?: AbortSignal) {
  return sanitizeReview(await e.json(req("review", reviewWriteback(input)), reviewSchema, signal), input.passages);
}

export async function reviewWeekSynthesis(e: Engine, input: Parameters<typeof reviewSynthesis>[0], signal?: AbortSignal) {
  return sanitizeReview(await e.json(req("review", reviewSynthesis(input)), reviewSchema, signal), input.passages);
}

export function reexplainLayer(e: Engine, input: Parameters<typeof reexplain>[0], signal?: AbortSignal): AsyncIterable<StreamChunk> {
  return e.stream(req("review", reexplain(input)), signal);
}

/** Let's talk!: the professor's answer, streamed. Uses the `talk` model (Sonnet by default). */
export function talkToProfessor(e: Engine, input: Parameters<typeof professor>[0], signal?: AbortSignal): AsyncIterable<StreamChunk> {
  return e.stream(req("talk", professor(input)), signal);
}

/** The Librarian: which passages a Let's talk! conversation rests on, by number. Uses the `talk` model (Sonnet by default). */
export const pickTalkSources = (e: Engine, input: Parameters<typeof collectSources>[0], signal?: AbortSignal) => e.json(req("talk", collectSources(input)), talkSourcesSchema, signal);

/** Quick notes: the student's saved write-up as short arrow-style notes to edit. Uses the `talk` model (Sonnet by default). */
export const draftQuickNotes = (e: Engine, input: Parameters<typeof quickNotes>[0], signal?: AbortSignal) => e.complete(req("talk", quickNotes(input)), signal);

/**
 * Write the Lecture tab from the counted facts and the layer's slides. Checked like Explained: a citation that points at nothing is asked about
 * once, then stripped, so no link to a made-up slide is ever shown. Slides and reading passages are both fair to cite.
 */
export async function writeLectureTab(e: Engine, input: Parameters<typeof writeLecture>[0], signal?: AbortSignal): Promise<{ writing: LectureWriting; stripped: string[] }> {
  const sent: SentPassage[] = [...input.slides, ...input.reading];
  const base = req("lecture", writeLecture(input));
  const texts = (w: LectureWriting) => w.blocks.flatMap((b) => (b.type === "paragraph" ? [b.text] : b.type === "bullets" ? b.items : []));
  let writing = await e.json(base, lectureWritingSchema, signal);
  let bad = texts(writing).flatMap((t) => invalidCitations(t, sent));
  if (bad.length) {
    const retry = { ...base, prompt: `${base.prompt}\n\nYour last answer cited sources that are not in the passages: ${[...new Set(bad)].join(", ")}. Cite only the files and slide or page numbers given.` };
    writing = await e.json(retry, lectureWritingSchema, signal);
    bad = texts(writing).flatMap((t) => invalidCitations(t, sent));
  }
  const stripped = [...new Set(bad)];
  if (stripped.length) {
    const fix = (t: string) => stripInvalidCitations(t, sent).text;
    writing = { blocks: writing.blocks.map((b) => (b.type === "paragraph" ? { ...b, text: fix(b.text) } : b.type === "bullets" ? { ...b, items: b.items.map(fix) } : b)) };
  }
  return { writing, stripped };
}

/** Which of the student's class-note lines belong to a layer, by number, plus gentle second-look lines. Uses the `notes` model (Sonnet by default). */
export const pickClassNotes = (e: Engine, input: Parameters<typeof filterNotes>[0], signal?: AbortSignal) => e.json(req("notes", filterNotes(input)), classNotesPickSchema, signal);

/** The exam room. All three run on the `exam` model (Opus 5.5 at medium effort by default). */
export const readSheet = (e: Engine, input: Parameters<typeof readExamSheet>[0], signal?: AbortSignal) => e.json(req("exam", readExamSheet(input)), examSummarySchema, signal);
export const updateDetails = (e: Engine, input: Parameters<typeof updateExamDetails>[0], signal?: AbortSignal) => e.json(req("exam", updateExamDetails(input)), examSummarySchema, signal);
export const writeQuestions = (e: Engine, input: Parameters<typeof writeExamQuestions>[0], signal?: AbortSignal) => e.json(req("exam", writeExamQuestions(input)), examQuestionsSchema, signal);
export const examine = (e: Engine, input: Parameters<typeof examineAnswers>[0], signal?: AbortSignal) => e.json(req("exam", examineAnswers(input)), examFeedbackSchema, signal);

/** A document an agent makes from the student's note (Opus 5.5 at medium effort by default). Citations are checked by the caller against what was sent. */
export const makeDocument = (e: Engine, input: Parameters<typeof makeAgentDocument>[0], signal?: AbortSignal) => e.json(req("request", makeAgentDocument(input)), agentDocumentSchema, signal);

/** The course brain: notes on one file read in full (the `brain` model, Sonnet by default). Passage numbers are checked by `lib/brain/read.ts`. */
export const readFileForBrain = (e: Engine, input: Parameters<typeof readForBrain>[0], signal?: AbortSignal) => e.json({ ...req("brain", readForBrain(input)), priority: "background" }, brainNotesSchema, signal);
/** A brain read before the stricter other-names rule, checked once: which notes merged different things or keep loose other names (the `check` model). */
export const checkOldBrainNames = (e: Engine, input: Parameters<typeof checkBrainNames>[0], signal?: AbortSignal) => e.json({ ...req("check", checkBrainNames(input), "check-names"), priority: "background" }, brainNamesCheckSchema, signal);
/** Which of the brain's notes a question is about, from the index of every note (the `talk` model, Sonnet by default). */
export const pickBrainNotes = (e: Engine, input: Parameters<typeof pickNotes>[0], signal?: AbortSignal) => e.json(req("talk", pickNotes(input), "talk-pick"), notePickSchema, signal);
