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

/**
 * A moment of a scene's scroll as a point on its view timeline. A scene's progress p runs from 0 (its top enters the window) to 1 (its
 * bottom reaches the window's bottom); the first ENTER of it, one window's height, is the timeline's "entry" range and the rest is its
 * "contain" range (a scene is taller than the window). The CSS animations of a scene take their ranges from here.
 */
export function timelineAt(p: number): string {
  const pct = (x: number) => `${Math.round(Math.min(100, Math.max(0, x * 100)) * 1000) / 1000}%`;
  return p <= ENTER ? `entry ${pct(p / ENTER)}` : `contain ${pct((p - ENTER) / (1 - ENTER))}`;
}
/** The animation range for the stretch of a scene's progress from a to b. */
export const scrollRange = (a: number, b: number) => `${timelineAt(a)} ${timelineAt(b)}`;
/** Where the headline's push-in reaches the middle of the window, as a share of its whole move (0 to ENTER + 0.12): the 68.684% keyframe of ov-title-in in overview.css. */
export const TITLE_MID = ENTER / (ENTER + 0.12);

/** Scroll timings for one sheet: it separates, then its leader draws, then its label appears. */
export function sheetTiming(i: number, n: number) {
  const gap = n > 1 ? 0.15 / (n - 1) : 0;
  const a = ENTER + 0.17 + i * gap;
  const b = a + 0.22;
  return { a, b, lineA: b - 0.02, lineB: b + 0.05, labelA: b + 0.02, labelB: b + 0.08 };
}
