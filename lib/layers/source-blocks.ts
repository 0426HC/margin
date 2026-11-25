import type { Block, BlockKind } from "@/lib/import/types";

/** A piece of a Source quote with the kind of block it came from, so headings, paragraphs and lists keep their shape. */
export interface QuoteBlock {
  kind: BlockKind;
  text: string;
}

const tokens = (text: string) => [...text.matchAll(/\S+/g)].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));

/**
 * The blocks behind each passage of one section. A section's passages are its words cut in order, with none dropped (a tested
 * guarantee of the import), so passage k covers words [a, b) of the section. This walks the section's original blocks and
 * slices out exactly those words, keeping the block kind and the original line breaks. The result is the same words as the
 * passage, still verbatim: only the paragraph, heading and list shape comes back.
 */
export function blocksForPassages(sectionBlocks: Block[], passageWordCounts: number[]): QuoteBlock[][] {
  const spans = sectionBlocks.map((b) => tokens(b.text));
  const out: QuoteBlock[][] = [];
  let from = 0;
  for (const count of passageWordCounts) {
    const to = from + count;
    const pieces: QuoteBlock[] = [];
    let offset = 0;
    spans.forEach((words, i) => {
      const a = Math.max(from, offset);
      const b = Math.min(to, offset + words.length);
      if (a < b) {
        const first = words[a - offset];
        const last = words[b - 1 - offset];
        pieces.push({ kind: sectionBlocks[i].kind, text: sectionBlocks[i].text.slice(first.start, last.end) });
      }
      offset += words.length;
    });
    out.push(pieces);
    from = to;
  }
  return out;
}
