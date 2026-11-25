/** Pixels of wheel or trackpad scroll that move the hero one sheet. */
export const PX_PER_WEEK = 110;

/** Wheel delta in pixels, whatever unit the device reports it in. */
export const wheelPixels = (e: { deltaY: number; deltaMode: number }, page = 800) => e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? page : 1);

/**
 * One wheel step over the sheets. `pos` is the hero's place in the row (0 = the first week, at the front; fractions are between sheets).
 * Scrolling down goes to later weeks. At the last week going down, or the first week going up, the wheel is not taken, so the page scrolls.
 */
export function wheelStep(pos: number, dy: number, weeks: number): { pos: number; capture: boolean } {
  const max = Math.max(weeks - 1, 0);
  if (dy === 0 || (dy > 0 && pos >= max - 1e-6) || (dy < 0 && pos <= 1e-6)) return { pos, capture: false };
  return { pos: Math.min(max, Math.max(0, pos + dy / PX_PER_WEEK)), capture: true };
}

/** What the labels under the big number say for a place in the row. */
export type WeekLabel = { kind: "on"; index: number } | { kind: "between"; a: number; b: number };
export function labelAt(pos: number): WeekLabel {
  const near = Math.round(pos);
  if (Math.abs(pos - near) < 0.04) return { kind: "on", index: near };
  return { kind: "between", a: Math.floor(pos), b: Math.floor(pos) + 1 };
}

/** The next sheet for a key press: from between two sheets, Right/Down goes to the later one and Left/Up to the earlier one. */
export function keyStep(pos: number, dir: 1 | -1, weeks: number): number {
  const max = Math.max(weeks - 1, 0);
  const near = Math.round(pos);
  const from = Math.abs(pos - near) < 0.04 ? near : dir > 0 ? Math.floor(pos) : Math.ceil(pos);
  return Math.min(max, Math.max(0, from + dir));
}
