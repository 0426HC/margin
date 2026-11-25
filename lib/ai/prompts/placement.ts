import type { PromptPair } from "./shared";

export interface PlacementLayer {
  n: number;
  part: string;
  weeks: string;
  title: string;
  bigQuestion: string;
}
export interface PlacementPassage {
  n: number;
  file: string;
  role: string;
  week: number | null;
  page: number;
  text: string;
}

/** Where new course material belongs: in an existing layer, or in a new layer for a topic the plan doesn't cover yet. The student approves new layers. */
export function placeMaterial(input: { layers: PlacementLayer[]; passages: PlacementPassage[]; feedback?: string }): PromptPair {
  const layers = input.layers.map((l) => `L${l.n} | ${l.part} | ${l.weeks} | ${l.title} | ${l.bigQuestion}`);
  const passages = input.passages.map((p) => `#${p.n} | ${p.role} | ${p.week ? `Week ${p.week}` : "no week"} | ${p.file} p. ${p.page} | ${p.text}`);
  return {
    system: `You place NEW course material into a student's existing layer plan. A layer is one topic of the course with one big question. The student has already studied some layers, so prefer adding material to a layer it belongs to over creating a new layer.
Rules:
- For each group of consecutive new passages, say which existing layer it belongs to (layer number, 1 or more) because it is about that layer's topic, or answer layer 0 for a topic that no existing layer covers. Lecture material (slides or lecture notes) usually belongs to the layer that covers the same topic as the reading of that week.
- A layer 0 group needs a short title, the ONE big question it answers (a real question ending in "?") and one line on how it builds on what comes before. For an existing layer leave title, bigQuestion and buildsOn empty.
- Passages are referred to by their numbers as inclusive ranges. Together the groups must cover every new passage exactly once: none in two groups, none left out.
- Do not create a new layer for a few passages that fit an existing one. Use only the text given. Never invent topics that are not there.`,
    prompt: `Existing layers (layer | week | weeks its text is from | title | big question):\n${layers.join("\n")}\n\nNew passages (number | what it is | week | file and page | start of the text):\n${passages.join("\n")}\n\n${input.feedback ? `Your last answer was rejected: ${input.feedback}\nFix these problems.\n\n` : ""}Place the new passages.`,
  };
}
