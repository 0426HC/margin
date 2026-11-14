import { stripInvalidCitations, invalidCitations, type SentPassage } from "./citations";
import { modelFor, type Task } from "./config";
import type { AiRequest, Engine, StreamChunk } from "./engine";
import { collectSources, explainLayer, layerBreakdown, partSplit, pickSource, professor, quickNotes, reexplain, reviewSynthesis, reviewWriteback } from "./prompts";
import type { PromptPair } from "./prompts";
import { explainedLayerSchema, layerBreakdownSchema, partSplitSchema, pickSourceSchema, reviewSchema, talkSourcesSchema, type ExplainedBlock, type ExplainedLayer, type Review } from "./schemas";

// Each function binds one prompt, its Zod schema and the model for its task. Components and routes call these, never an engine directly.
const req = (task: Task, pair: PromptPair): AiRequest => ({ ...pair, ...modelFor(task) });

export const proposePartSplit = (e: Engine, input: Parameters<typeof partSplit>[0], signal?: AbortSignal) => e.json(req("structure", partSplit(input)), partSplitSchema, signal);
export const proposeLayers = (e: Engine, input: Parameters<typeof layerBreakdown>[0], signal?: AbortSignal) => e.json(req("structure", layerBreakdown(input)), layerBreakdownSchema, signal);
export const pickLayerSource = (e: Engine, input: Parameters<typeof pickSource>[0], signal?: AbortSignal) => e.json(req("explain", pickSource(input)), pickSourceSchema, signal);

const eachText = (blocks: ExplainedBlock[]): string[] =>
  blocks.flatMap((b) => (b.type === "paragraph" ? [b.text] : b.type === "bullets" ? b.items : b.type === "table" ? [b.source] : []));

const mapBlocks = (blocks: ExplainedBlock[], fix: (t: string) => string): ExplainedBlock[] =>
  blocks.map((b) => (b.type === "paragraph" ? { ...b, text: fix(b.text) } : b.type === "bullets" ? { ...b, items: b.items.map(fix) } : b.type === "table" ? { ...b, source: fix(b.source) } : b));

/** Write the Explained tab. A citation that points at nothing is asked about once, then stripped, so no link to a made-up source is ever shown. */
export async function writeExplained(e: Engine, input: Parameters<typeof explainLayer>[0], signal?: AbortSignal): Promise<{ explained: ExplainedLayer; stripped: string[] }> {
  const sent: SentPassage[] = input.passages;
  const base = req("explain", explainLayer(input));
  let explained = await e.json(base, explainedLayerSchema, signal);
  let bad = eachText(explained.blocks).flatMap((t) => invalidCitations(t, sent));
  if (bad.length) {
    const retry = { ...base, prompt: `${base.prompt}\n\nYour last answer cited sources that are not in the passages: ${[...new Set(bad)].join(", ")}. Cite only the files and pages given.` };
    explained = await e.json(retry, explainedLayerSchema, signal);
    bad = eachText(explained.blocks).flatMap((t) => invalidCitations(t, sent));
  }
  const stripped = [...new Set(bad)];
  if (stripped.length) explained = { ...explained, blocks: mapBlocks(explained.blocks, (t) => stripInvalidCitations(t, sent).text) };
  return { explained, stripped };
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

export async function reviewPartSynthesis(e: Engine, input: Parameters<typeof reviewSynthesis>[0], signal?: AbortSignal) {
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
