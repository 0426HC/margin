import type { SourceQuote } from "@/lib/db/schema";
import type { QuoteBlock } from "./source-blocks";
import type { OrderedPassage } from "./types";

const FALLBACK_PASSAGES = 3;

/**
 * The Source tab. The AI only says which passages (by their number in the layer); this copies their text
 * exactly as stored. A number that isn't one of the layer's passages is dropped. Nothing the model writes is ever shown.
 * If nothing valid was picked, the layer's first passages are used so the tab is never empty.
 */
export function copySource(picks: number[], layerPassages: OrderedPassage[], blocks?: Map<string, QuoteBlock[]>): SourceQuote[] {
  const byN = new Map(layerPassages.map((p) => [p.n, p]));
  let chosen = [...new Set(picks)].filter((n) => byN.has(n)).sort((a, b) => a - b).map((n) => byN.get(n)!);
  if (!chosen.length) chosen = layerPassages.slice(0, FALLBACK_PASSAGES);
  return chosen.map((p) => ({ passageId: p.passageId, file: p.file, page: p.page, text: p.text, ...(blocks?.get(p.passageId) ? { blocks: blocks.get(p.passageId) } : {}) }));
}
