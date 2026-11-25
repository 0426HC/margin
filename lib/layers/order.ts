import type { StructureLayer, StructureModel } from "./types";

export type FlatLayer = StructureLayer & { week: number; weekLabel: string };

/** Every layer in course order, week by week. This is the order [ and ] walk through. */
export function flattenLayers(model: Pick<StructureModel, "weeks">): FlatLayer[] {
  return model.weeks.flatMap((w) => w.layers.map((l) => ({ ...l, week: w.week, weekLabel: w.label })));
}

/** The layer before and after this one, across week boundaries. Nothing is locked, so there is no "next unlocked". */
export function neighbours(flat: FlatLayer[], id: string) {
  const i = flat.findIndex((l) => l.id === id);
  return { index: i, prev: i > 0 ? flat[i - 1] : undefined, next: i >= 0 ? flat[i + 1] : undefined };
}

/** "Week 3 · The Constitution, layer 2 of 4" */
export function positionLabel(flat: FlatLayer[], id: string): string {
  const here = flat.find((l) => l.id === id);
  if (!here) return "";
  const inWeek = flat.filter((l) => l.week === here.week);
  return `${here.weekLabel}, layer ${inWeek.findIndex((l) => l.id === id) + 1} of ${inWeek.length}`;
}
