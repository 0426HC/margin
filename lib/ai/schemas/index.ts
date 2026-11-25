import { z } from "zod";
import { splitCitations } from "../citations";
import { FILE_TYPES } from "@/lib/projects/file-kinds";

const hasCitation = (t: string) => splitCitations(t).some((p) => "cite" in p);
const withoutCitations = (t: string) => splitCitations(t).map((p) => ("text" in p ? p.text : "")).join(" ");
const sentenceCount = (t: string) => withoutCitations(t).trim().split(/(?<=[.!?])\s+(?=[A-Z"“(])/).filter(Boolean).length;
const cited = z.string().min(1).refine(hasCitation, "every factual claim needs a [file, p. N] citation");

/** The quick first look at a folder: which files are the syllabus, by id ("F3"). */
export const syllabusPickSchema = z.object({ syllabus: z.array(z.string()).max(3) });
export type SyllabusPick = z.infer<typeof syllabusPickSchema>;

const courseWeek = z.object({
  week: z.number().int().min(1).max(60),
  date: z.string().max(60).nullable(),
  title: z.string().max(140),
  kind: z.enum(["class", "no-class", "exam"]),
  syllabus: z.string().max(1200),
});
/** A break the syllabus doesn't number (a reading week, a holiday): it sits after a numbered week and is never a week of its own. */
const courseBreak = z.object({ afterWeek: z.number().int().min(0).max(60), date: z.string().max(60).nullable(), title: z.string().max(140) });
const fileLabel = z.object({
  file: z.string(),
  week: z.number().int().nullable(),
  type: z.enum(FILE_TYPES),
  confidence: z.enum(["sure", "check"]),
  reason: z.string().min(3).max(300),
  /** Only for a file the syllabus assigns in parts to different weeks: each week's pages, in the printed page numbers. */
  pages: z.array(z.object({ week: z.number().int(), from: z.number().int().min(1), to: z.number().int().min(1) })).max(20).default([]),
});
const missingReading = z.object({ week: z.number().int().nullable(), reading: z.string().min(2).max(300) });

/**
 * The course read like a person reads it: its weeks in the course's own numbering (breaks between them listed apart), and every file's
 * week, type, how sure and why. The shape is checked here; that every file is labelled once and every week is in the course is checked
 * by code (`lib/import/organize.ts`).
 */
export const courseMapSchema = z.object({
  courseCode: z.string().max(20).nullable(),
  weeks: z.array(courseWeek).max(60),
  breaks: z.array(courseBreak).max(12).default([]),
  files: z.array(fileLabel),
  missingReadings: z.array(missingReading).max(80),
  notInSyllabus: z.array(z.string()),
});
export type CourseMapAnswer = z.infer<typeof courseMapSchema>;
/** An answer as Claude may write it (a file's "pages" may be left out). */
export type CourseMapAnswerIn = z.input<typeof courseMapSchema>;

/**
 * The final check of a sorted course: only what should change. A null list means "keep it as it is"; `files` holds only files to fix or
 * mark "check", each with its full new label. Code merges it and checks the result again.
 */
export const courseCheckSchema = z.object({
  weeks: z.array(courseWeek).max(60).nullable(),
  breaks: z.array(courseBreak).max(12).nullable(),
  missingReadings: z.array(missingReading).max(80).nullable(),
  files: z.array(fileLabel),
  notes: z.array(z.string().min(3).max(400)).max(8),
});
export type CourseCheck = z.infer<typeof courseCheckSchema>;
export type CourseCheckIn = z.input<typeof courseCheckSchema>;

/** Courses imported before the page-range rule: each file saved in several folders, with its pages by week (empty when not split). */
export const pageRangesSchema = z.object({ files: z.array(fileLabel.pick({ file: true, pages: true })) });
export type PageRangesAnswer = z.infer<typeof pageRangesSchema>;

/** Layers of one week. Passages are referred to by the numbers they were sent with, inclusive ranges. More than five parse, and code merges them down to five. */
export const layerBreakdownSchema = z.object({
  layers: z
    .array(
      z.object({
        title: z.string().min(2).max(80),
        bigQuestion: z.string().min(8).max(220).refine((q) => q.trim().endsWith("?"), "the big question must be a question"),
        /** How this layer follows the previous one. Empty for the first layer. */
        buildsOn: z.string().max(240),
        ranges: z.array(z.object({ from: z.number().int().min(1), to: z.number().int().min(1) }).refine((r) => r.to >= r.from, "range ends before it starts")).min(1),
      }),
    )
    .min(1)
    .max(12),
});
export type LayerBreakdown = z.infer<typeof layerBreakdownSchema>;

/** The passages a layer's explanation rests on, by the numbers they were sent with. Code copies the text. */
export const pickSourceSchema = z.object({
  passages: z.array(z.number().int().min(1)).min(1).max(60),
});
export type PickSource = z.infer<typeof pickSourceSchema>;

/** The sources the Librarian picks after a Let's talk! conversation: topics, each with passage numbers. Code copies the text. */
export const talkSourcesSchema = z.object({
  topics: z
    .array(z.object({ topic: z.string().trim().min(2).max(60), passages: z.array(z.number().int().min(1)).min(1).max(12) }))
    .max(12),
});
export type TalkSources = z.infer<typeof talkSourcesSchema>;

const block = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text: z.string().min(1).max(120) }),
  z.object({ type: z.literal("paragraph"), text: cited }),
  z.object({ type: z.literal("bullets"), items: z.array(cited).min(1) }),
  z.object({
    type: z.literal("table"),
    caption: z.string().min(1).max(160),
    columns: z.array(z.string().min(1)).min(2),
    rows: z.array(z.array(z.string())).min(1),
    /** Citations for the whole table. */
    source: cited,
  }).refine((t) => t.rows.every((r) => r.length === t.columns.length), "every table row needs one cell per column"),
]);

/** The Explained tab as it was written before Round 3: a summary, blocks that each cite, a so what. Layers keep it until refreshed. */
export const explainedV1Schema = z.object({
  /** The gist for quick revision: three to five plain sentences, before the full explanation. Explanations written before it existed have none. */
  summary: z.string().min(40).max(1200),
  blocks: z.array(block).min(3).max(80),
  /** The layer's key "so what". Links to the bigger argument and other layers, so it may not cite. */
  soWhat: z.string().min(20).max(600),
});
export type ExplainedV1 = z.infer<typeof explainedV1Schema>;

/** A block of a section of the new Explained. Facts carry [file, p. N] citations; sentences of analysis need none (code checks each section rests on cited material). */
const sectionBlock = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), text: z.string().min(1) }),
  z.object({ type: z.literal("bullets"), items: z.array(z.string().min(1)).min(1) }),
  z.object({
    type: z.literal("table"),
    caption: z.string().min(1).max(160),
    columns: z.array(z.string().min(1)).min(2),
    rows: z.array(z.array(z.string())).min(1),
    source: z.string(),
  }).refine((t) => t.rows.every((r) => r.length === t.columns.length), "every table row needs one cell per column"),
]);

/**
 * The Explained tab: a teacher's explanation and analysis, not a summary. A 2-3 sentence summary; the layer's big question (filled by
 * code); sections that each answer one sub-question of it (the sub-question is the heading), saying how and why, with every named concept
 * explained where it matters; and the so what, linked to the week and the course. Claude writes it as streamed text
 * (`lib/layers/explained-text.ts`); this schema checks what the text was read into.
 */
const explainedSection = z.object({ question: z.string().min(5).max(200), blocks: z.array(sectionBlock).min(1).max(30) });
export const explainedSchema = z.object({
  summary: z.string().min(20).max(1200),
  sections: z.array(explainedSection).min(2).max(8),
  soWhat: z.string().min(20).max(1200),
});
export type ExplainedOut = z.infer<typeof explainedSchema>;
export type ExplainedSection = z.infer<typeof explainedSection>;
/**
 * As stored: the new shape with the layer's big question, which code adds. `conceptsChecked` is false while the named-things check waits
 * for the brain to read the layer's files (`checkLayerConcepts`); layers written before it existed have none.
 */
export type ExplainedV2 = ExplainedOut & { version: 2; question: string; conceptsChecked?: boolean };
export type ExplainedSectionBlock = z.infer<typeof sectionBlock>;

/** Named things a written Explained left unexplained: for each, the section (by number) where it matters and the sentences to add there. */
export const explainMissingSchema = z.object({
  additions: z.array(z.object({ name: z.string().min(1).max(120), section: z.number().int().min(1), text: z.string().min(10).max(1200) })).max(40),
});
export type ExplainMissing = z.infer<typeof explainMissingSchema>;

/** Either shape: old layers keep the explanation they had until they are refreshed. */
export type ExplainedLayer = ExplainedV1 | ExplainedV2;
export const isExplainedV2 = (e: ExplainedLayer): e is ExplainedV2 => "sections" in e;
export type ExplainedBlock = z.infer<typeof block>;

export const FIX_KINDS = ["fact", "term", "name", "missing", "vague", "grammar"] as const;

/** A review of one write-back: fixes, the user's own text cleaned up, one so-what, and a verdict. */
export const reviewSchema = z
  .object({
    fixes: z.array(z.object({ kind: z.enum(FIX_KINDS), text: z.string().min(1).max(500) })).max(12),
    cleanedUp: z.string().min(1),
    soWhat: z.string().min(10).max(400).refine((t) => sentenceCount(t) === 1, "the so what is exactly one sentence"),
    verdict: z.enum(["approved", "needs_work"]),
  })
  .refine((r) => r.verdict === "needs_work" || r.fixes.length === 0 || r.fixes.every((f) => f.kind === "grammar" || f.kind === "vague"), {
    message: "a write-back with factual, term, name or missing-content fixes can't be approved",
    path: ["verdict"],
  })
  .refine((r) => r.verdict === "approved" || r.fixes.length > 0, { message: "needs_work must list at least one fix", path: ["fixes"] });
export type Review = z.infer<typeof reviewSchema>;

/** Where new passages belong: an existing layer (its number), or layer 0 for a new topic. Passages are referred to by number. */
export const placementSchema = z.object({
  placements: z
    .array(
      z.object({
        layer: z.number().int().min(0),
        title: z.string().max(80),
        bigQuestion: z.string().max(220),
        buildsOn: z.string().max(240),
        ranges: z.array(z.object({ from: z.number().int().min(1), to: z.number().int().min(1) }).refine((r) => r.to >= r.from, "range ends before it starts")).min(1),
      }),
    )
    .min(1)
    .max(40),
});
export type Placement = z.infer<typeof placementSchema>;

const lectureBlock = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text: z.string().min(1).max(120) }),
  z.object({ type: z.literal("paragraph"), text: cited }),
  z.object({ type: z.literal("bullets"), items: z.array(cited).min(1) }),
  /** A plain one-line statement that there is nothing to report ("Nothing on the slides is marked as important."). The only block allowed to go without a citation. */
  z.object({ type: z.literal("none"), text: z.string().min(1).max(200) }),
]);

/** The Lecture tab's prose. Every paragraph and bullet cites the slides (or the reading) it comes from as [file, p. N]. */
export const lectureWritingSchema = z.object({ blocks: z.array(lectureBlock).min(3).max(40) });
export type LectureWriting = z.infer<typeof lectureWritingSchema>;
export type LectureBlock = z.infer<typeof lectureBlock>;

/** Which of the student's numbered class-note lines are about this layer, and where the notes and the slides seem to disagree. */
export const classNotesPickSchema = z.object({
  relevant: z.array(z.number().int().min(1)).max(80),
  checks: z.array(z.object({ line: z.number().int().min(1), text: z.string().min(10).max(300) })).max(6),
});
export type ClassNotesPick = z.infer<typeof classNotesPickSchema>;
export * from "./exam";

/** A document an agent makes from the student's note. It may instead decline (graded work), with a plain message and something it can do instead. */
export const agentDocumentSchema = z
  .object({
    declined: z.object({ message: z.string().trim().min(5).max(400), alternative: z.string().trim().min(5).max(300) }).nullable(),
    title: z.string().trim().min(3).max(100),
    blocks: z
      .array(
        z.discriminatedUnion("type", [
          z.object({ type: z.literal("heading"), text: z.string().min(1).max(120) }),
          z.object({ type: z.literal("paragraph"), text: cited }),
          z.object({ type: z.literal("bullets"), items: z.array(cited).min(1).max(30) }),
        ]),
      )
      .max(60),
  })
  .refine((d) => d.declined !== null || d.blocks.length >= 2, { message: "a document needs at least two blocks", path: ["blocks"] });
export type AgentDocumentOut = z.infer<typeof agentDocumentSchema>;

export const BRAIN_KINDS = ["concept", "person", "event", "case", "place", "reading"] as const;

/** The course brain's notes on one file. Passage numbers are the ones sent; code checks them and maps them to the real file and page. */
export const brainNotesSchema = z.object({
  notes: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        kind: z.enum(BRAIN_KINDS),
        aliases: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
        what: z.string().trim().min(10).max(900),
        why: z.string().trim().min(5).max(500),
        passages: z.array(z.number().int().min(1)).max(20),
        related: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
      }),
    )
    .min(1)
    .max(120),
});
export type BrainNotesAnswer = z.infer<typeof brainNotesSchema>;

/** Notes of an older brain that break the other-names rule: the different things each really holds. Only notes to change. */
export const brainNamesCheckSchema = z.object({
  notes: z
    .array(
      z.object({
        note: z.string().trim().min(1),
        things: z.array(z.object({ name: z.string().trim().min(1).max(120), aliases: z.array(z.string().trim().min(1).max(120)).max(12).default([]), mentions: z.array(z.number().int().min(1)).min(1) })).min(1).max(8),
      }),
    )
    .max(80),
});
export type BrainNamesCheck = z.infer<typeof brainNamesCheckSchema>;

/** The notes a question is about, by the ids in the brain's index. */
export const notePickSchema = z.object({ notes: z.array(z.string()).max(12) });
