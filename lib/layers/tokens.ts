/** The distinctive words of a text, for comparing what texts are about (optional readings beside layers, the fallback search). */

const STOP = new Set(
  "the and for with that this from are was were has have had not but you your our their its into out over under about than then them they his her him she who whom what which when where why how can may will would should could one two also been being more most some such only other any all each both these those there here page pages slide slides week weeks lecture course".split(
    " ",
  ),
);

export const tokens = (text: string): string[] => (text.toLowerCase().match(/[a-z]{4,}|\d+/g) ?? []).filter((t) => !STOP.has(t));
