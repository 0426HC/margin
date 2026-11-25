// Deterministic looks. A project's title seeds its hue, its unit colours and its motifs,
// so a course looks the same every time it opens and different from every other course.
import { BookOpen, Compass, Gavel, Landmark, Link2, Map, Scale, ScrollText, Swords, Users, Crown, Vote, type LucideIcon } from "lucide-react";

export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type RGB = [number, number, number];

export function hsl(h: number, s: number, l: number): RGB {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

export const rgbCss = (c: RGB, a = 1) => `rgb(${c[0]} ${c[1]} ${c[2]} / ${a})`;
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t].map(Math.round) as RGB;

/**
 * The accent hues, and the only ones a project can use: cyan blue, sky, ink blue, indigo, violet, plum
 * and orchid. No gold, amber or brown (the palette is cool), no green, and no red, which means errors.
 */
const HUES = [196, 222, 236, 250, 270, 292, 312];

/** Saturated, never neon: mid lightness, so the colour reads on walnut without glowing. */
export function unitAccents(title: string, count: number): RGB[] {
  const r = rng(hashSeed(title));
  const start = Math.floor(r() * HUES.length);
  const step = [2, 3, 4, 5][Math.floor(r() * 4)]; // all coprime with 7, so neighbours always differ
  return Array.from({ length: count }, (_, i) => {
    const h = HUES[(start + i * step) % HUES.length];
    // Blues need a little more lightness than golds to hold up against the desk.
    const l = h > 200 ? 0.6 + r() * 0.04 : 0.54 + r() * 0.04;
    return hsl(h, 0.55 + r() * 0.12, l);
  });
}

export const MOTIFS = ["contours", "rings", "drift", "dots", "web"] as const;
export type Motif = (typeof MOTIFS)[number];

/** Each project walks the motif list from its own starting point, so neighbours always differ. */
export function unitMotifs(title: string, count: number): Motif[] {
  const start = hashSeed(title + ":motif") % MOTIFS.length;
  const step = 1 + (hashSeed(title + ":step") % 2) * 1; // 1 or 2: both are coprime with 5
  return Array.from({ length: count }, (_, i) => MOTIFS[(start + i * (step + 1)) % MOTIFS.length]);
}

const ICON_KEYS: [RegExp, LucideIcon][] = [
  [/syllabus|overview|course|start/, Map],
  [/union|together|confeder/, Link2],
  [/faction|divis|conflict|fight/, Swords],
  [/republic|structure|govern/, Landmark],
  [/power|balance|check|ambition/, Scale],
  [/branch|executive|president/, Crown],
  [/court|judic|law/, Gavel],
  [/election|represent|vote|people/, Vote],
  [/people|one/, Users],
  [/essay|paper|text|read/, ScrollText],
  [/why|stakes|choice/, Compass],
];

/** Three icons for a unit, chosen from the words in its name, focus lines and why-note. */
export function unitIcons(words: string): LucideIcon[] {
  const text = words.toLowerCase();
  const found: LucideIcon[] = [];
  for (const [re, icon] of ICON_KEYS) if (re.test(text) && !found.includes(icon)) found.push(icon);
  for (const fallback of [BookOpen, Scale, Landmark]) if (found.length < 3 && !found.includes(fallback)) found.push(fallback);
  return found.slice(0, 3);
}
