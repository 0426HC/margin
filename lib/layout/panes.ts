// Pane geometry for the three-pane workspace, as pure functions so it can be tested.
export const RAIL = 48; // the collapsed left pane
export const GAP = 10;
export const MIN_MID = 480; // the reading pane never gets narrower than this
export const LEFT = { min: 220, max: 400, def: 272 } as const;
export const RIGHT = { min: 320, max: 560, def: 384 } as const;
/** Below this width the section list starts collapsed. */
export const NARROW = 1180;

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** How wide each side pane may get, given the window and the other pane. */
export function paneLimits(width: number, leftCol: number, rightCol: number) {
  const room = width - 2 * GAP - 2 * GAP - MIN_MID;
  return {
    leftMax: Math.max(LEFT.min, Math.min(LEFT.max, room - rightCol)),
    rightMax: Math.max(RIGHT.min, Math.min(RIGHT.max, room - leftCol)),
  };
}

/** One arrow-key step for a pane resizer. `invert` is for the right pane, which grows leftward. */
export function nudge(value: number, key: string, shift: boolean, min: number, max: number, invert = false) {
  const step = shift ? 48 : 16;
  if (key === "ArrowLeft") return clamp(value + (invert ? step : -step), min, max);
  if (key === "ArrowRight") return clamp(value + (invert ? -step : step), min, max);
  return value;
}

const TOPBAR = 44;

/** Where the reading pane sits on first paint at this window size, so the overview's zoom can land exactly on it. */
export function paperRect(vw: number, vh: number) {
  const narrow = vw < NARROW;
  const left = narrow ? RAIL : LEFT.def;
  const right = narrow ? 340 : RIGHT.def;
  const x = GAP + left + GAP;
  return { x, y: TOPBAR, w: vw - x - GAP - right - GAP, h: vh - TOPBAR - GAP };
}

/** Survives a client-side navigation, so the workspace knows which layer the zoom opened. */
export const arrival: { layerId: string | null } = { layerId: null };

/** Lets the overview return to the scene you left. */
export const overviewReturn: { y: number | null } = { y: null };
