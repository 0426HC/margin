import type { OrderedPassage } from "./types";

export interface UnitSummary {
  n: number; // 1-based, in course order
  unitId: string;
  title: string;
  words: number;
  /** Index (0-based) of the unit's first passage in reading order. */
  start: number;
}

export function summariseUnits(passages: OrderedPassage[]): UnitSummary[] {
  const out: UnitSummary[] = [];
  passages.forEach((p, i) => {
    const last = out[out.length - 1];
    if (last?.unitId === p.unitId) last.words += p.words;
    else out.push({ n: out.length + 1, unitId: p.unitId, title: p.unit, words: p.words, start: i });
  });
  return out;
}

/**
 * Where Part B starts, as the 0-based index of its first passage: the unit boundary nearest the middle by word count.
 * A course with a single unit is split at the passage nearest the middle instead.
 */
export function defaultSplit(passages: OrderedPassage[]): number {
  const total = passages.reduce((n, p) => n + p.words, 0);
  const units = summariseUnits(passages);
  const boundaries = units.length >= 2 ? units.slice(1).map((u) => u.start) : passages.map((_, i) => i).slice(1);
  let before = 0;
  let best = boundaries[0] ?? 1;
  let bestGap = Infinity;
  let at = 0;
  for (const b of boundaries) {
    for (; at < b; at++) before += passages[at].words;
    const gap = Math.abs(before - total / 2);
    if (gap < bestGap) [best, bestGap] = [b, gap];
  }
  return best;
}

/** The passage index where a unit starts, if the AI's "Part B starts at unit N" is a real unit boundary (2 or more). */
export function splitAtUnit(passages: OrderedPassage[], n: number): number | null {
  const units = summariseUnits(passages);
  return Number.isInteger(n) && n >= 2 && n <= units.length ? units[n - 1].start : null;
}
