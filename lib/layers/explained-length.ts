import { isExplainedV2, type ExplainedLayer, type ExplainedSection } from "@/lib/ai/schemas";

/**
 * How long a layer's explanation should be. A week's explanation, all its layers together, runs to about 4,000 words, shared between the
 * layers by how much source text each has: a layer with half the week's reading gets about half. Each layer gets at least EXPLAINED_MIN
 * words. Counted over the whole explanation (summary, sections and so what), citations left out. Pure.
 */
export const WEEK_EXPLAINED = 4_000;
export const EXPLAINED_MIN = 600;
/** A layer may run this much over its share before sections are written shorter, and must reach this much of it. */
const OVER = 1.25;
const UNDER = 0.6;

export interface ExplainedBudget {
  /** The length to aim for. */
  target: number;
  /** The most it may run to. */
  max: number;
  /** The least it should come to. */
  min: number;
}

const round50 = (n: number) => Math.round(n / 50) * 50;

/** The budget for one layer, from its source words and its week's. */
export function explainedBudget(layerWords: number, weekWords: number): ExplainedBudget {
  const share = weekWords > 0 ? (WEEK_EXPLAINED * layerWords) / weekWords : WEEK_EXPLAINED;
  const target = Math.max(EXPLAINED_MIN, round50(share));
  return { target, max: round50(target * OVER), min: round50(target * UNDER) };
}

export const words = (t: string) => t.replace(/\[[^\]\n]+?,\s*(?:p|pp|slide)\.?\s*[\d–-]+\]/gi, " ").split(/\s+/).filter(Boolean).length;

/** How many words one section runs to: its heading and blocks, citations left out. */
export function sectionWords(sec: ExplainedSection): number {
  let n = words(sec.question);
  for (const b of sec.blocks) {
    if (b.type === "paragraph") n += words(b.text);
    else if (b.type === "bullets") n += b.items.reduce((a, t) => a + words(t), 0);
    else n += words(`${b.caption} ${b.columns.join(" ")} ${b.rows.flat().join(" ")}`);
  }
  return n;
}

/** How many words the explanation runs to (citations not counted). */
export function explainedWords(e: ExplainedLayer): number {
  const n = words(e.summary ?? "") + words(e.soWhat);
  if (isExplainedV2(e)) return n + e.sections.reduce((a, s) => a + sectionWords(s), 0);
  let m = n;
  for (const b of e.blocks) {
    if (b.type === "heading" || b.type === "paragraph") m += words(b.text);
    else if (b.type === "bullets") m += b.items.reduce((a, t) => a + words(t), 0);
    else if (b.type === "table") m += words(`${b.caption} ${b.columns.join(" ")} ${b.rows.flat().join(" ")}`);
  }
  return m;
}
