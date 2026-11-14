import type { Range } from "./types";

export const USUAL_LAYERS = { min: 4, max: 8 };
export const SHORT_LAYER_WORDS = 300;
export const LONG_LAYER_WORDS = 6000;

export interface BreakdownCheck {
  /** Reasons the proposal can't be used. Empty means it can. */
  errors: string[];
}

const label = (a: number, b: number) => (a === b ? `passage ${a}` : `passages ${a} to ${b}`);

/** Runs of consecutive numbers, as [from, to] pairs. */
function runs(nums: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const n of [...nums].sort((x, y) => x - y)) {
    const last = out[out.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else out.push([n, n]);
  }
  return out;
}

/**
 * Check a proposed breakdown of one Part against its passages (numbered 1 to `count`).
 * Every passage must be in exactly one layer: none missing, none used twice, none that don't exist.
 * A layer may take passages from several places, because a topic can run through more than one reading;
 * layers need not follow reading order either, because they are ordered to build on each other.
 */
export function validateBreakdown(layers: { ranges: Range[] }[], count: number): BreakdownCheck {
  const errors: string[] = [];
  const owner = new Array<number>(count + 1).fill(0); // 1-based passage number -> the layer that took it
  const twice = new Set<number>();
  layers.forEach((layer, li) => {
    for (const r of layer.ranges) {
      if (r.from < 1 || r.to > count) {
        errors.push(`Layer ${li + 1} uses ${label(r.from, r.to)}, but only passages 1 to ${count} exist.`);
        continue;
      }
      for (let n = r.from; n <= r.to; n++) {
        if (owner[n]) twice.add(n);
        owner[n] = li + 1;
      }
    }
  });
  for (const [a, b] of runs([...twice])) errors.push(`${label(a, b)} ${a === b ? "is" : "are"} used by more than one layer. Each passage belongs to exactly one layer.`);
  const missing: number[] = [];
  for (let n = 1; n <= count; n++) if (!owner[n]) missing.push(n);
  for (const [a, b] of runs(missing)) errors.push(`${label(a, b)} ${a === b ? "is" : "are"} not in any layer.`);
  return { errors: [...new Set(errors)] };
}

/** Warnings about a layer's size or a Part's layer count. These don't block anything: the student decides. */
export function layerWarnings(words: number): string[] {
  if (words < SHORT_LAYER_WORDS) return [`Short: about ${words} words. Consider merging it with a neighbour.`];
  if (words > LONG_LAYER_WORDS) return [`Long: about ${words.toLocaleString("en-US")} words. Consider splitting it.`];
  return [];
}

export function partWarnings(layerCount: number): string[] {
  if (layerCount < USUAL_LAYERS.min || layerCount > USUAL_LAYERS.max) return [`${layerCount} ${layerCount === 1 ? "layer" : "layers"}. Four to eight is usual for a Part.`];
  return [];
}
