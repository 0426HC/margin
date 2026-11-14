import { isRealHeading } from "./text-quality";
import { wordCount, type Block, type ParsedFile, type Section } from "./types";

/**
 * Cuts a file into sections by its own structure, in reading order, with code and no AI:
 * headings, then numbered or named parts, then slides (never split), then page ranges.
 * Text is only ever grouped. It is never rewritten, reordered or dropped.
 */

const MAX_WORDS = 2300; // about 10 minutes at 230 words a minute
const TINY_WORDS = 450; // below this a part is merged into a neighbour
const SLIDE_MIN_WORDS = 150; // a slide takes at least this long to take in, however few words it has
const NAMED_PART =
  /^(?:federalist\s+no\.?\s*\d+|(?:part|chapter|section|book|article|lecture|week|unit)\s+(?:[ivxlc]+|\d+)\b.{0,60}|\d{1,2}\.\s+\S.{0,70}|[IVXLC]+\.(?:\s+\S.{0,70})?)$/i;

interface Part {
  title?: string;
  blocks: Block[];
  /** Effective words: real words, except slides count for at least SLIDE_MIN_WORDS. */
  eff: number;
}

const words = (bs: Block[]) => bs.reduce((n, b) => n + wordCount(b.text), 0);
const mk = (blocks: Block[], title?: string): Part => ({ blocks, title, eff: words(blocks) });
const cutAt = <T,>(items: T[], cuts: number[]): T[][] => [0, ...cuts].map((s, i) => items.slice(s, cuts[i] ?? items.length));

/** The cut indexes that divide `sizes` into the fewest balanced groups that each fit under `max`. */
function balancedCuts(sizes: number[], max: number): number[] {
  const total = sizes.reduce((a, b) => a + b, 0);
  const n = Math.min(sizes.length, Math.ceil(total / max));
  if (n <= 1) return [];
  const prefix = [0];
  for (const s of sizes) prefix.push(prefix[prefix.length - 1] + s);
  const cuts: number[] = [];
  let prev = 0;
  for (let k = 1; k < n; k++) {
    const want = (total * k) / n;
    let best = prev + 1;
    for (let b = prev + 1; b <= sizes.length - (n - k); b++) if (Math.abs(prefix[b] - want) < Math.abs(prefix[best] - want)) best = b;
    cuts.push(best);
    prev = best;
  }
  return cuts;
}

const groupByPage = (blocks: Block[]): Block[][] =>
  blocks.reduce<Block[][]>((acc, b) => {
    const last = acc[acc.length - 1];
    if (last && last[0].page === b.page) last.push(b);
    else acc.push([b]);
    return acc;
  }, []);

function titlePieces(part: Part, groups: Block[][]): Part[] {
  return groups.map((g, i) => mk(g, part.title ? `${part.title} (part ${i + 1} of ${groups.length})` : undefined));
}

const SMALL_WORDS = new Set(["a", "an", "the", "of", "and", "in", "on", "to", "for", "or", "at", "by", "with", "from", "as", "is"]);

/** A short, title-cased or all-caps line that stands alone before a real paragraph: a heading the file did not mark up. */
function looksLikeHeadingLine(b: Block, next?: Block): boolean {
  if (b.kind !== "paragraph" || !next || next.kind === "heading" || wordCount(next.text) < 20) return false;
  const t = b.text.trim();
  const ws = t.split(/\s+/);
  if (ws.length > 10 || t.length > 80 || /[.?!,;:]$/.test(t) || !/^\p{Lu}/u.test(t) || !isRealHeading(t)) return false;
  if (t === t.toUpperCase()) return true;
  const big = ws.filter((w) => !SMALL_WORDS.has(w.toLowerCase()));
  return big.length > 0 && big.filter((w) => /^[\p{Lu}\p{N}"“‘(]/u.test(w)).length / big.length >= 0.75;
}

/** Cut points inside a long part, from the reading's own headings: marked-up ones first, then title-like lines. */
function innerCuts(blocks: Block[]): { cuts: number[]; blocks: Block[] } {
  const marked = blocks.flatMap((b, i) => (i > 0 && b.kind === "heading" && isRealHeading(b.text) ? [i] : []));
  if (marked.length) {
    const top = Math.min(...marked.map((i) => blocks[i].level ?? 1));
    return { cuts: marked.filter((i) => (blocks[i].level ?? 1) === top), blocks };
  }
  const like = blocks.flatMap((b, i) => (i > 0 && looksLikeHeadingLine(b, blocks[i + 1]) ? [i] : []));
  const promoted = blocks.map((b, i) => (like.includes(i) ? { ...b, kind: "heading" as const, level: 4 } : b));
  return { cuts: like, blocks: promoted };
}

/**
 * Split a part that is too long. First at the reading's own headings, then at pages (untitled runs),
 * then at paragraph boundaries with part numbers.
 */
function splitLong(part: Part): Part[] {
  if (part.eff <= MAX_WORDS) return [part];
  const inner = innerCuts(part.blocks);
  if (inner.cuts.length) {
    const pieces = cutAt(inner.blocks, inner.cuts).map((g, i) => mk(g, i === 0 ? part.title : isRealHeading(g[0].text) ? g[0].text : undefined));
    return pieces.flatMap(splitLong);
  }
  const pages = !part.title ? groupByPage(part.blocks) : [];
  if (pages.length && pages.every((p) => words(p) <= MAX_WORDS)) {
    return titlePieces(part, cutAt(pages, balancedCuts(pages.map(words), MAX_WORDS)).map((g) => g.flat()));
  }
  let cuts = balancedCuts(part.blocks.map((b) => wordCount(b.text)), MAX_WORDS);
  // never leave a heading stranded at the end of a piece
  cuts = cuts.map((c, i) => (part.blocks[c - 1]?.kind === "heading" && c - 1 > (cuts[i - 1] ?? 0) ? c - 1 : c));
  return titlePieces(part, cutAt(part.blocks, cuts));
}

/** Cut at every heading of `level`. Blocks before the first one are a preamble. */
function cutAtHeadings(blocks: Block[], level: number): Part[] {
  const idx = blocks.map((b, i) => (b.kind === "heading" && b.level === level ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return [mk(blocks)];
  const parts = cutAt(blocks, idx[0] === 0 ? idx.slice(1) : idx).map((g) => mk(g, g[0].kind === "heading" && isRealHeading(g[0].text) ? g[0].text : undefined));
  // a preamble that is only headings (a document title) rides along with the first real part
  if (idx[0] > 0 && parts.length > 1 && parts[0].blocks.every((b) => b.kind === "heading")) {
    const [pre, next] = parts;
    parts.splice(0, 2, { ...next, blocks: [...pre.blocks, ...next.blocks], eff: pre.eff + next.eff });
  }
  return parts;
}

const levelsOf = (blocks: Block[]): number[] =>
  [...new Set(blocks.filter((b) => b.kind === "heading").map((b) => b.level ?? 1))].sort((a, b) => a - b);

function byHeadings(blocks: Block[], levels: number[]): Part[] {
  const [level, ...deeper] = levels;
  return cutAtHeadings(blocks, level).flatMap((part) => {
    if (part.eff <= MAX_WORDS || !deeper.length) return [part];
    const inner = levelsOf(part.blocks).filter((l) => deeper.includes(l));
    if (!inner.length) return [part];
    const subs = byHeadings(part.blocks, inner);
    return subs.length > 1 ? subs : [part];
  });
}

/** "FEDERALIST No. 10" style lines become headings, if there are at least two of them. */
function markNamedParts(blocks: Block[]): Block[] | null {
  const hit = new Set(
    blocks.flatMap((b, i) => (b.kind === "paragraph" && b.text.length <= 90 && NAMED_PART.test(b.text.trim()) ? [i] : [])),
  );
  // two or more are parts; a single one is only the file's title if it opens the file
  if (hit.size < 2 && !hit.has(0)) return null;
  return blocks.map((b, i) => (hit.has(i) ? { ...b, kind: "heading" as const, level: 1 } : b));
}

/** A short unpunctuated line right after the marker is its subtitle, so it goes into the title too. */
function withSubtitles(parts: Part[]): Part[] {
  return parts.map((part) => {
    const next = part.blocks[1];
    const isSub = next && next.kind === "paragraph" && next.text.length <= 200 && !/[.?!]$/.test(next.text.trim()) && isRealHeading(next.text);
    return part.title && isSub ? { ...part, title: `${part.title}: ${next.text.trim()}` } : part;
  });
}

function slideParts(blocks: Block[]): Part[] {
  const slides = groupByPage(blocks);
  const size = (s: Block[]) => Math.max(SLIDE_MIN_WORDS, words(s));
  return cutAt(slides, balancedCuts(slides.map(size), MAX_WORDS)).map((group) => {
    const flat = group.flat();
    const first = flat[0];
    const title = (first.kind === "heading" || first.text.length <= 80) && isRealHeading(first.text) ? first.text : undefined;
    return { title, blocks: flat, eff: group.reduce((n, s) => n + size(s), 0) };
  });
}

/** Fold parts under TINY_WORDS into the shorter neighbour, as long as the result still fits. */
function mergeTiny(parts: Part[]): Part[] {
  const out = [...parts];
  const stuck = new Set<Part>();
  for (;;) {
    const i = out.findIndex((p) => p.eff < TINY_WORDS && !stuck.has(p));
    if (i < 0 || out.length < 2) return out;
    const fits = [i - 1, i + 1].filter((j) => j >= 0 && j < out.length && out[j].eff + out[i].eff <= MAX_WORDS);
    if (!fits.length) {
      stuck.add(out[i]);
      continue;
    }
    const j = fits.reduce((a, b) => (out[b].eff < out[a].eff ? b : a));
    const [first, second] = j < i ? [out[j], out[i]] : [out[i], out[j]];
    out.splice(Math.min(i, j), 2, { title: first.title ?? second.title, blocks: [...first.blocks, ...second.blocks], eff: first.eff + second.eff });
  }
}

const label = (a: number, b: number, one: string, many: string) => (a === b ? `${one} ${a}` : `${many} ${a}–${b}`);

export function splitSections(file: ParsedFile): Section[] {
  const { blocks, pageKind } = file;
  if (!blocks.length) return [];

  let parts: Part[];
  let docTitle: string | undefined;
  if (pageKind === "slide") {
    parts = slideParts(blocks);
  } else {
    let levels = levelsOf(blocks);
    const top = levels[0];
    // a single heading at the very start is the document's title, not a part
    if (levels.length > 1 && blocks[0].kind === "heading" && blocks[0].level === top && blocks.filter((b) => b.kind === "heading" && b.level === top).length === 1) {
      docTitle = blocks[0].text;
      levels = levels.slice(1);
    }
    const marked = levels.length ? null : markNamedParts(blocks);
    if (levels.length) parts = byHeadings(blocks, levels);
    else if (marked) parts = withSubtitles(byHeadings(marked, [1]));
    else parts = [mk(blocks)];
    parts = parts.flatMap(splitLong);
  }

  const merged = mergeTiny(parts);
  // a file that folds down to one section is named by its own title, not by its first sub-heading
  if (merged.length === 1 && docTitle) merged[0] = { ...merged[0], title: docTitle };

  let at = 0; // parts are contiguous and in order, so a running offset finds each part's place in the file
  return merged.map((part) => {
    const start = at;
    at += part.blocks.length;
    const pages = part.blocks.map((b) => b.page);
    const pageStart = Math.min(...pages);
    const pageEnd = Math.max(...pages);
    const slides = pageKind === "slide";
    const where = slides ? label(pageStart, pageEnd, "slide", "slides") : label(pageStart, pageEnd, "p.", "pp.");
    let title = part.title;
    if (!title) {
      // no real heading of its own: the nearest real heading before it, plus where it is
      const prior = blocks.slice(0, start).reverse().find((b) => b.kind === "heading" && isRealHeading(b.text));
      title = prior ? `${prior.text.trim()} (${where})` : slides ? label(pageStart, pageEnd, "Slide", "Slides") : label(pageStart, pageEnd, "Page", "Pages");
    }
    return { title, blocks: part.blocks, pageStart, pageEnd, wordCount: words(part.blocks) };
  });
}
