import { z } from "zod";
import { splitCitations } from "../citations";

const hasCitation = (t: string) => splitCitations(t).some((p) => "cite" in p);
const withoutCitations = (t: string) => splitCitations(t).map((p) => ("text" in p ? p.text : "")).join(" ");
const sentenceCount = (t: string) => withoutCitations(t).trim().split(/(?<=[.!?])\s+(?=[A-Z"“(])/).filter(Boolean).length;
const cited = z.string().min(1).refine(hasCitation, "every factual claim needs a [file, p. N] citation");

/** Which unit starts Part B. Units are numbered from 1 in the order they were sent. */
export const partSplitSchema = z.object({
  firstUnitOfPartB: z.number().int().min(2),
  reason: z.string().min(1).max(400),
});
export type PartSplit = z.infer<typeof partSplitSchema>;

/** Layers of one Part. Passages are referred to by the numbers they were sent with, in reading order, inclusive ranges. */
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

export const explainedLayerSchema = z.object({
  blocks: z.array(block).min(3).max(60),
  /** The layer's key "so what". Links to the bigger argument and other layers, so it may not cite. */
  soWhat: z.string().min(20).max(600),
});
export type ExplainedLayer = z.infer<typeof explainedLayerSchema>;
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
