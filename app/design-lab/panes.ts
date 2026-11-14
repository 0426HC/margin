// The design lab shares the real pane geometry (with plain number types, so its panes can be resized in state).
import { LEFT as L, RIGHT as R } from "@/lib/layout/panes";
export { RAIL, GAP, MIN_MID, paperRect, arrival, overviewReturn } from "@/lib/layout/panes";
type Range = { min: number; max: number; def: number };
export const LEFT: Range = { ...L };
export const RIGHT: Range = { ...R };
