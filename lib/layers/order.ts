import type { StructureLayer, StructureModel } from "./types";

export type FlatLayer = StructureLayer & { partKey: "A" | "B"; partTitle: string };

/** Every layer in course order: Part A's layers, then Part B's. This is the order [ and ] walk through. */
export function flattenLayers(model: Pick<StructureModel, "parts">): FlatLayer[] {
  return model.parts.flatMap((p) => p.layers.map((l) => ({ ...l, partKey: p.key, partTitle: p.title })));
}

/** The layer before and after this one, across the Part boundary. Nothing is locked, so there is no "next unlocked". */
export function neighbours(flat: FlatLayer[], id: string) {
  const i = flat.findIndex((l) => l.id === id);
  return { index: i, prev: i > 0 ? flat[i - 1] : undefined, next: i >= 0 ? flat[i + 1] : undefined };
}

/** "Part A, layer 2 of 4" */
export function positionLabel(flat: FlatLayer[], id: string): string {
  const here = flat.find((l) => l.id === id);
  if (!here) return "";
  const inPart = flat.filter((l) => l.partKey === here.partKey);
  return `${here.partTitle}, layer ${inPart.findIndex((l) => l.id === id) + 1} of ${inPart.length}`;
}
