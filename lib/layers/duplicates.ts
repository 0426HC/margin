/**
 * The same topic must not appear as two layers. Two layers are duplicates when their titles say the same thing (the same meaningful
 * words, give or take one) or when most of one layer's text is also in the other (the same reading filed twice). Pure.
 */

const STOP = new Set(
  "a an and the of in on to into from for with by as at its it their this that these those how why what when who whom which is are was were be toward towards between about after before during over under through week wk lecture lec unit part topic module session chapter section class reading readings continued".split(" "),
);

/** The meaningful words of a title, lower case, plural "s" dropped: "American myths and the road into Vietnam" → american, myth, road, vietnam. */
export function titleWords(title: string): Set<string> {
  return new Set(
    (title.toLowerCase().match(/[a-z0-9]+/g) ?? [])
      .filter((w) => !STOP.has(w) && (w.length > 1 || /\d/.test(w)))
      .map((w) => (w.length > 4 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)),
  );
}

/** Same topic by title: most words shared (Jaccard 0.6 or more), or one title's words all inside the other's (at least two of them). */
export function sameTitle(a: string, b: string): boolean {
  const x = titleWords(a);
  const y = titleWords(b);
  // numbers tell topics apart: "Federalist 10" is not "Federalist 51", "Midterm 1 review" is not "Midterm 2 review"
  const nx = [...x].filter((w) => /^\d+$/.test(w)).sort().join(",");
  const ny = [...y].filter((w) => /^\d+$/.test(w)).sort().join(",");
  if (nx && ny && nx !== ny) return false;
  if (!x.size || !y.size) return a.trim().toLowerCase() === b.trim().toLowerCase();
  const shared = [...x].filter((w) => y.has(w)).length;
  const union = new Set([...x, ...y]).size;
  if (shared / union >= 0.6) return true;
  const small = x.size <= y.size ? x : y;
  return small.size >= 2 && shared === small.size;
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Same text: at least 60% of the smaller layer's passages appear, word for word, in the other. */
export function sameText(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  const [small, big] = a.length <= b.length ? [a, b] : [b, a];
  const have = new Set(big.map(norm));
  return small.filter((t) => have.has(norm(t))).length / small.length >= 0.6;
}

export interface DupCandidate {
  title: string;
  texts?: string[];
}

/** Pairs [i, j] (i < j) of layers that are the same topic. */
export function duplicatePairs(layers: DupCandidate[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < layers.length; i++)
    for (let j = i + 1; j < layers.length; j++)
      if (sameTitle(layers[i].title, layers[j].title) || sameText(layers[i].texts ?? [], layers[j].texts ?? [])) out.push([i, j]);
  return out;
}

/** Reasons for the model, so a retry can fix them: one line per duplicate pair, numbered from 1. */
export function duplicateReasons(layers: DupCandidate[], earlier: string[] = []): string[] {
  const reasons = duplicatePairs(layers).map(([i, j]) => `Layers ${i + 1} ("${layers[i].title}") and ${j + 1} ("${layers[j].title}") are the same topic. Merge them into one layer.`);
  layers.forEach((l, i) => {
    const twin = earlier.find((t) => sameTitle(t, l.title));
    if (twin) reasons.push(`Layer ${i + 1} ("${l.title}") repeats "${twin}", a layer of another week. Give it a different topic, or fold its passages into a neighbouring layer.`);
  });
  return reasons;
}
