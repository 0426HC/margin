// The exploded diagram: sheets laid out in an isometric plane, pulled apart along one axis.
// CSS applies rotateZ first, then rotateX, so these constants describe the projection.
export const ROT_X = 58;
export const ROT_Z = -42;
const cosZ = Math.cos((ROT_Z * Math.PI) / 180);
const sinZ = Math.sin((ROT_Z * Math.PI) / 180);
const cosX = Math.cos((ROT_X * Math.PI) / 180);
const sinX = Math.sin((ROT_X * Math.PI) / 180);

/** Each scene's scroll length. The first 100vh is the scene sliding into view. */
export const SCENE_VH = 380;
export const ENTER = 100 / SCENE_VH;

export type Viewport = { w: number; h: number };

/** A label is a one-line title and a focus line or two. Its height must fit in the gap between rows. */
export const LABEL = { title: 22, gap: 2, line: 21 };
export const labelHeight = (lines: number) => LABEL.title + LABEL.gap + lines * LABEL.line;
/** Two lines of focus when the rows are far enough apart, else one, so labels never touch at 12 layers. */
export const focusLines = (step: number): 1 | 2 => (step === 0 || step >= labelHeight(2) + 4 ? 2 : 1);

export function diagram(vp: Viewport, n: number) {
  const s = Math.max(0.66, Math.min(1.1, vp.w / 1440));
  const W = 320 * s;
  const H = 200 * s;
  const halfW = cosZ * (W / 2) - sinZ * (H / 2); // screen half-width of the tilted sheet
  const cornerY = (sinZ * (W / 2) + cosZ * (H / 2)) * cosX; // its right corner, relative to centre
  const halfH = (-sinZ * (W / 2) + cosZ * (H / 2)) * cosX;
  const cx = vp.w * 0.555;
  const cy = vp.h / 2 + 22;
  const room = vp.h - 120 - 2 * halfH;
  const step = n > 1 ? Math.min(176 * s, room / (n - 1)) : 0;
  const rowY = (i: number) => cy + (i - (n - 1) / 2) * step;
  // First section on top, in reading order.
  const liftZ = (i: number) => (((n - 1) / 2 - i) * step) / sinX;
  const stackZ = (i: number) => ((n - 1) / 2 - i) * 3;
  const labelX = cx + halfW + 46 * s;
  return { s, W, H, halfW, cornerY, halfH, cx, cy, rowY, liftZ, stackZ, labelX, labelW: vp.w - labelX - 40, step };
}

/** Scroll timings for one sheet: it separates, then its leader draws, then its label appears. */
export function sheetTiming(i: number, n: number) {
  const gap = n > 1 ? 0.15 / (n - 1) : 0;
  const a = ENTER + 0.17 + i * gap;
  const b = a + 0.22;
  return { a, b, lineA: b - 0.02, lineB: b + 0.05, labelA: b + 0.02, labelB: b + 0.08 };
}
