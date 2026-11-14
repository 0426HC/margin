import type { LayerBreakdown } from "@/lib/ai/schemas";
import type { OrderedPassage } from "./types";

const MIN_FALLBACK_WORDS = 600;

/**
 * A plain breakdown by unit, used when the AI's proposal is invalid twice.
 * Tiny units are folded into the one before. A Part that is a single unit is cut into up to four pieces by word count.
 */
export function fallbackBreakdown(passages: OrderedPassage[]): LayerBreakdown {
  type Group = { title: string; from: number; to: number; words: number };
  const groups: Group[] = [];
  passages.forEach((p) => {
    const g = groups[groups.length - 1];
    if (g && g.title === p.unit) {
      g.to = p.n;
      g.words += p.words;
    } else groups.push({ title: p.unit, from: p.n, to: p.n, words: p.words });
  });
  const merged: Group[] = [];
  for (const g of groups) {
    const prev = merged[merged.length - 1];
    if (prev && (g.words < MIN_FALLBACK_WORDS || prev.words < MIN_FALLBACK_WORDS)) {
      prev.to = g.to;
      prev.words += g.words;
      prev.title = `${prev.title} and ${g.title}`;
    } else merged.push({ ...g });
  }
  if (merged.length < 2 && passages.length >= 2) {
    const total = passages.reduce((n, p) => n + p.words, 0);
    const pieces = Math.min(4, passages.length);
    const base = merged[0]?.title ?? "This part";
    const cuts: Group[] = [];
    let acc = 0;
    let from = 1;
    passages.forEach((p, i) => {
      acc += p.words;
      const done = cuts.length + 1;
      if ((acc >= (total * done) / pieces && done < pieces) || i === passages.length - 1) {
        cuts.push({ title: `${base}, part ${done}`, from, to: p.n, words: acc });
        from = p.n + 1;
      }
    });
    merged.splice(0, merged.length, ...cuts);
  }
  return {
    layers: merged.map((g, i) => ({
      title: g.title.slice(0, 80),
      bigQuestion: `What are the main ideas in ${g.title}?`.slice(0, 220),
      buildsOn: i === 0 ? "" : `Follows ${merged[i - 1].title}.`.slice(0, 240),
      ranges: [{ from: g.from, to: g.to }],
    })),
  };
}
