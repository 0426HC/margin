/** A layer (or a week synthesis) is either saved to Note to Self or not. There is nothing in between and nothing is locked. */
export type LayerState = "not_saved" | "saved";

export interface ProgressCounts {
  total: number;
  saved: number;
  notSaved: number;
}

export function countStates(states: LayerState[]): ProgressCounts {
  const saved = states.filter((x) => x === "saved").length;
  return { total: states.length, saved, notSaved: states.length - saved };
}

/** "4/7 layers saved". */
export function progressLabel(c: ProgressCounts): string {
  return `${c.saved}/${c.total} ${c.total === 1 ? "layer" : "layers"} saved`;
}

export const STATE_WORD: Record<LayerState, string> = {
  not_saved: "Not saved",
  saved: "Saved",
};
