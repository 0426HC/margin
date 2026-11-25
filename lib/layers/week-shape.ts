/**
 * The shape of one week's layers, checked by code after the AI proposes them. A week has at most five layers. A layer longer than
 * SPLIT_ABOVE words is cut into consecutive layers by its real parts (a court case's facts, majority opinion, concurrences and dissents,
 * then a new file, then a new heading) while the week still has room; when it has none, layers simply cover more. Pure.
 */

export const MAX_LAYERS_PER_WEEK = 5;
/** A week with at least this many words of material has at least two layers. */
export const TWO_LAYERS_FROM = 1_500;
/** One idea longer than this is split, if the week has fewer than five layers. */
export const SPLIT_ABOVE = 8_000;
/** Roughly how long a layer may grow when a week is heavy, rather than adding a sixth layer. */
export const HEAVY_LAYER_WORDS = 10_000;
/** A layer this long in a full week is clearly past "about 10,000": the week's five layers are evened out. */
export const FAR_OVER = HEAVY_LAYER_WORDS * 1.2;

export interface ShapePassage {
  words: number;
  text: string;
  file: string;
  sectionId: string;
  /** The heading of the section the passage is in, as the import cut it. */
  sectionTitle?: string;
}

export interface ShapeLayer {
  title: string;
  bigQuestion: string;
  buildsOn: string;
  /** Passage numbers (1-based, into the week's passages), in the order the layer reads them. */
  passages: number[];
}

/** A judge's name as written in an opinion's heading ("JACKSON" → "Jackson", "McREYNOLDS" → "McReynolds"). */
const cap = (w: string) => {
  const one = (x: string) => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase();
  const mc = /^(Ma?c)([A-Z].+)$/.exec(w);
  return mc ? `${mc[1]}${one(mc[2])}` : one(w);
};
const JUSTICE = String.raw`(?:mr\.?\s+|mrs\.?\s+|ms\.?\s+)?(?:chief\s+)?justice\s+([A-Za-z'’-]{2,})`;
const DELIVERED = new RegExp(`${JUSTICE}\\s+delivered\\s+the\\s+opinion\\s+of\\s+the\\s+court`, "i");
const SEPARATE = new RegExp(`${JUSTICE}(?:,\\s*with\\s+whom[\\s\\S]{0,160}?\\bjoin[a-z]*)?\\s*,\\s*(concurring|dissenting)(\\s+in\\s+(?:the\\s+judgment|part))?`, "i");
const PER_CURIAM = /\bper\s+curiam\b/i;
const FACTS = /^\s*(?:syllabus\b|statement\s+of\s+(?:the\s+)?(?:facts|case)\b|facts\s+of\s+the\s+case\b|the\s+facts\b)/i;

/** The part of a court case that starts in this passage ("Jackson, concurring"), or null when none does. */
export function opinionPart(text: string): string | null {
  const head = text.slice(0, 1200);
  const sep = SEPARATE.exec(head);
  if (sep) return `${cap(sep[1])}, ${sep[2].toLowerCase()}${sep[3] ? sep[3].toLowerCase().replace(/\s+/g, " ") : ""}`;
  const del = DELIVERED.exec(head);
  if (del) return `Opinion of the Court (${cap(del[1])})`;
  if (PER_CURIAM.test(head.slice(0, 200))) return "Opinion of the Court";
  if (FACTS.test(head)) return "The facts";
  return null;
}

const GENERIC_SECTION = /^(?:pages?|pp?\.|slides?|part)\s*[\d–-]/i;
const stem = (file: string) => file.replace(/\.[a-z0-9]{1,5}$/i, "");

/** How good a place it is to start a new layer at passage `i` of `list` (a real part beginning scores highest). */
function boundaryScore(list: ShapePassage[], i: number): number {
  if (i <= 0) return 0;
  const a = list[i - 1];
  const b = list[i];
  if (opinionPart(b.text)) return 3;
  if (a.file !== b.file) return 3;
  if (a.sectionId !== b.sectionId) return 1.5;
  return 0;
}

/**
 * Cut a list of passages into `k` consecutive pieces of about equal length, preferring to cut where a real part begins (`extra` adds to
 * how good a cut is, for boundaries the caller knows about; `pull` is how far a real part may draw a cut from even length). Returns
 * the index where each piece after the first starts.
 */
export function balancedCuts(list: ShapePassage[], k: number, extra: (i: number) => number = () => 0, pull = 0.35): number[] {
  const n = list.length;
  if (k <= 1 || n < 2) return [];
  k = Math.min(k, n);
  const prefix = [0];
  for (const p of list) prefix.push(prefix[prefix.length - 1] + p.words);
  const target = prefix[n] / k || 1;
  const cost = (from: number, to: number) => ((prefix[to] - prefix[from] - target) / target) ** 2;
  // best[j][i]: the cheapest way to make j pieces from the first i passages
  const best = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(Infinity));
  const from = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(0));
  best[0][0] = 0;
  for (let j = 1; j <= k; j++)
    for (let i = j; i <= n - (k - j); i++)
      for (let c = j - 1; c < i; c++) {
        if (best[j - 1][c] === Infinity) continue;
        const v = best[j - 1][c] + cost(c, i) - (c > 0 ? pull * (boundaryScore(list, c) + extra(c)) : 0);
        if (v < best[j][i]) {
          best[j][i] = v;
          from[j][i] = c;
        }
      }
  const cuts: number[] = [];
  for (let j = k, i = n; j > 1; j--) {
    i = from[j][i];
    cuts.unshift(i);
  }
  return cuts;
}

/** What to call the piece starting at `i`: the court-case part, the heading, or the file it starts. */
function pieceName(list: ShapePassage[], i: number, first: ShapePassage): string | null {
  const p = list[i];
  const part = opinionPart(p.text);
  if (part) return part;
  if (i > 0 && p.file !== list[i - 1].file && p.file !== first.file) return stem(p.file);
  if (i === 0 || p.sectionId !== list[i - 1].sectionId) {
    // the import names a long file's pieces "Youngstown … (part 8 of 12)": that is not a part's name, only the file's
    const heading = (p.sectionTitle ?? "").replace(/\s*\(part \d+ of \d+\)\s*$/i, "").trim();
    if (heading && !GENERIC_SECTION.test(heading) && heading.toLowerCase() !== stem(p.file).toLowerCase()) return clip(heading, 50);
  }
  return null;
}

const wordsOf = (l: ShapeLayer, ps: ShapePassage[]) => l.passages.reduce((n, x) => n + (ps[x - 1]?.words ?? 0), 0);
const clip = (t: string, n: number) => (t.length <= n ? t : `${t.slice(0, n - 1).replace(/\s+\S*$/, "")}…`);

/** Split one layer into `k` consecutive layers by its real parts. The first keeps the title and question; the others are named for their part. */
export function splitByParts(layer: ShapeLayer, ps: ShapePassage[], k: number): ShapeLayer[] {
  const list = layer.passages.map((n) => ps[n - 1]);
  const cuts = balancedCuts(list, k);
  if (!cuts.length) return [layer];
  const starts = [0, ...cuts];
  const pieces: ShapeLayer[] = [];
  starts.forEach((start, j) => {
    const end = starts[j + 1] ?? list.length;
    const name = pieceName(list, start, list[0]);
    const title = j === 0 ? (name && /^(?:the facts|opinion of the court)/i.test(name) ? clip(`${layer.title}: ${name}`, 80) : layer.title) : clip(name ? `${layer.title}: ${name}` : `${layer.title} (${j + 1} of ${starts.length})`, 80);
    pieces.push({
      title,
      bigQuestion: j === 0 ? layer.bigQuestion : clip(name ? `What does ${/^(?:the|opinion)/i.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name} add to ${layer.title}?` : `How does ${layer.title} continue?`, 218).replace(/\?*$/, "?"),
      buildsOn: j === 0 ? layer.buildsOn : clip(`Follows ${pieces[j - 1].title}.`, 240),
      passages: layer.passages.slice(start, end),
    });
  });
  return pieces;
}

/**
 * A heavy week whose ideas don't divide evenly (one long court case beside a short lecture) can still leave one layer far over the limit.
 * Then the week's ideas, kept in their order, are cut again into five even layers, cutting where an idea ends or a real part begins
 * when that is close enough. Each layer keeps the title of the idea it mostly covers; one that continues an idea is named for its part.
 */
function rebalance(layers: ShapeLayer[], ps: ShapePassage[]): ShapeLayer[] {
  const seq = layers.flatMap((l, li) => l.passages.map((n) => ({ n, li })));
  const list = seq.map((x) => ps[x.n - 1]);
  // here even length matters most: a boundary only draws a cut a little way
  const cuts = balancedCuts(list, MAX_LAYERS_PER_WEEK, (i) => (seq[i].li !== seq[i - 1].li ? 1 : 0), 0.03);
  const starts = [0, ...cuts];
  const used = new Map<number, number>();
  const out: ShapeLayer[] = [];
  starts.forEach((start, j) => {
    const slice = seq.slice(start, starts[j + 1] ?? seq.length);
    const tally = new Map<number, number>();
    for (const x of slice) tally.set(x.li, (tally.get(x.li) ?? 0) + ps[x.n - 1].words);
    const main = [...tally].sort((a, b) => b[1] - a[1])[0][0];
    const idea = layers[main];
    const times = used.get(main) ?? 0;
    used.set(main, times + 1);
    // named from where its main idea starts in it, not from a stray passage of the idea before
    const firstMain = start + slice.findIndex((x) => x.li === main);
    const opens = firstMain === 0 || seq[firstMain - 1].li !== main;
    const name = pieceName(list, firstMain, list[0]);
    const fresh = times === 0 && opens;
    out.push({
      title: fresh ? idea.title : clip(name ? `${idea.title}: ${name}` : `${idea.title} (continued)`, 80),
      bigQuestion: fresh ? idea.bigQuestion : clip(name ? `What does ${/^(?:the|opinion)/i.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name} add to ${idea.title}?` : `How does ${idea.title} continue?`, 218).replace(/\?*$/, "?"),
      buildsOn: j === 0 ? idea.buildsOn : clip(`Follows ${out[j - 1].title}.`, 240),
      passages: slice.map((x) => x.n),
    });
  });
  return out;
}

/** Merge two neighbouring layers: the first's question stays, the titles join. */
function mergePair(a: ShapeLayer, b: ShapeLayer): ShapeLayer {
  return { title: clip(`${a.title} and ${b.title}`, 80), bigQuestion: a.bigQuestion, buildsOn: a.buildsOn, passages: [...a.passages, ...b.passages] };
}

/**
 * Hold a week's layers to the rules: at least two once the week has TWO_LAYERS_FROM words (a lone layer is cut in two by its real parts),
 * at most five (the two neighbours that are shortest together are merged until there are five), and
 * no idea over SPLIT_ABOVE words while the week has room (the longest is cut into more pieces first, so a heavy week ends with five layers
 * of even length; if ideas of very different sizes still leave one far over the limit, the five are evened out). Layers keep their order;
 * every passage stays in exactly one layer.
 */
export function shapeWeek(layers: ShapeLayer[], ps: ShapePassage[]): ShapeLayer[] {
  let out = layers.filter((l) => l.passages.length).map((l) => ({ ...l, passages: [...l.passages] }));
  while (out.length > MAX_LAYERS_PER_WEEK) {
    let at = 0;
    let least = Infinity;
    for (let i = 0; i + 1 < out.length; i++) {
      const w = wordsOf(out[i], ps) + wordsOf(out[i + 1], ps);
      if (w < least) [least, at] = [w, i];
    }
    out.splice(at, 2, mergePair(out[at], out[at + 1]));
  }
  // how many pieces each layer becomes: give each spare place to the layer that is longest per piece, while it is over the limit
  const words = out.map((l) => wordsOf(l, ps));
  const pieces = out.map(() => 1);
  let room = MAX_LAYERS_PER_WEEK - out.length;
  while (room > 0) {
    let at = -1;
    let most = SPLIT_ABOVE;
    words.forEach((w, i) => {
      if (w / pieces[i] > most && pieces[i] < out[i].passages.length) [most, at] = [w / pieces[i], i];
    });
    if (at < 0) break;
    pieces[at]++;
    room--;
  }
  out = out.flatMap((l, i) => (pieces[i] > 1 ? splitByParts(l, ps, pieces[i]) : [l]));
  // still one layer far over the limit in a full week: even the five out
  if (out.length === MAX_LAYERS_PER_WEEK && Math.max(...out.map((l) => wordsOf(l, ps))) > FAR_OVER) out = rebalance(out, ps);
  if (out.length === 1 && out[0].passages.length > 1 && wordsOf(out[0], ps) >= TWO_LAYERS_FROM) out = splitByParts(out[0], ps, 2);
  return out;
}
