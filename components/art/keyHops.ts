/** The laptop keyboard, in the keyboard plane's own units (u along the laptop's width, v toward you). */
export const KEY = { u0: 18, v0: 14, pitchU: 20.3, pitchV: 17, w: 17, h: 13.5, cols: 13, rows: 5 } as const;
/** The space bar takes columns 4 to 8 of the bottom row. */
export const SPACE = { from: 4, to: 8 } as const;

export interface Key {
  id: string;
  u: number;
  v: number;
  row: number;
  col: number;
  space?: boolean;
}

/** Every key the hero can land on: the centre of each letter key, and the space bar as one key. */
export function keys(): Key[] {
  const out: Key[] = [];
  for (let row = 0; row < KEY.rows; row++)
    for (let col = 0; col < KEY.cols; col++) {
      if (row === KEY.rows - 1 && col >= SPACE.from && col <= SPACE.to) continue;
      out.push({ id: `${row}:${col}`, row, col, u: KEY.u0 + col * KEY.pitchU + KEY.w / 2, v: KEY.v0 + row * KEY.pitchV + KEY.h / 2 });
    }
  const row = KEY.rows - 1;
  const left = KEY.u0 + SPACE.from * KEY.pitchU;
  const right = KEY.u0 + SPACE.to * KEY.pitchU + KEY.w;
  out.push({ id: "space", row, col: (SPACE.from + SPACE.to) / 2, u: (left + right) / 2, v: KEY.v0 + row * KEY.pitchV + KEY.h / 2, space: true });
  return out;
}

/**
 * How likely a key is: mostly the middle rows and middle columns (the letter keys), sometimes the space bar, rarely the edges; nearer keys
 * a little more likely, so the hops stay short.
 */
export function weight(k: Key, from: Key | null): number {
  if (from && k.id === from.id) return 0;
  const rowW = k.space ? 1.1 : [0.18, 1, 1, 1, 0.08][k.row];
  const colW = k.space ? 1 : Math.exp(-(((k.col - 6) / 2.6) ** 2));
  const near = from ? Math.exp(-Math.hypot(k.u - from.u, (k.v - from.v) * 1.2) / 70) : 1;
  return rowW * colW * near;
}

/** A small seeded random generator, so the dance is the same every time (and in tests). */
export function seeded(seed = 7) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickKey(all: Key[], from: Key | null, rand: () => number): Key {
  const ws = all.map((k) => weight(k, from));
  let r = rand() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < all.length; i++) if ((r -= ws[i]) <= 0) return all[i];
  return all[all.length - 1];
}
