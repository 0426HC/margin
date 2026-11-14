import type { NumberedPassage, PromptPair } from "./shared";

/** Propose where Part A ends. The code checks the answer, and the student can move the split. */
export function partSplit(units: { n: number; title: string; words: number }[]): PromptPair {
  return {
    system: `You help a student split a university course into two halves, Part A and Part B. Choose the unit where Part B starts so the halves are close to equal in material and the course's own structure (a syllabus midpoint, an exam, a change of theme) is respected. Use only the unit list given. Answer with the unit number and one sentence of reason.`,
    prompt: `Units, in course order:\n${units.map((u) => `${u.n}. ${u.title} (${u.words} words)`).join("\n")}\n\nWhich unit number does Part B start with? It must be 2 or more.`,
  };
}

/** Propose the layers of one Part, split by topic. Passages are shown by number with a short preview. */
export function layerBreakdown(input: { part: "A" | "B"; passages: (NumberedPassage & { unit: string })[]; previousPartLayers?: string[]; /** Why the last proposal was rejected, so it can be fixed. */ feedback?: string }): PromptPair {
  const lines = input.passages.map((p) => `#${p.n} | ${p.unit} | ${p.file} p. ${p.page} | ${p.text.split(/\s+/).slice(0, 28).join(" ")}…`);
  return {
    system: `You help a student learn a course layer by layer. Split Part ${input.part} of the course into LAYERS, by topic.
Rules:
- Aim for 4 to 8 layers. The number depends on how the material naturally divides: a week with two big topics can become two layers, and two short related weeks can become one. Do not split strictly by week, and do not force a number.
- Each layer has a short title, the ONE big question it answers (a real question ending in "?"), and one line on how it builds on the previous layer (empty for the first).
- The layers must build on each other, in an order that makes sense for learning.
- Each layer is made of passages, referred to by their numbers, as one or more inclusive ranges. If a topic runs through several readings, one layer may take a range from each. Together the layers must cover every passage exactly once: no passage in two layers, none left out. Order the layers so each builds on the one before.
- Use only the passage previews given. Do not invent topics that are not there.`,
    prompt: `${input.previousPartLayers?.length ? `Layers already chosen for the earlier Part (for continuity):\n${input.previousPartLayers.map((t) => `- ${t}`).join("\n")}\n\n` : ""}Passages of Part ${input.part} (number | unit | file and page | start of the text):\n${lines.join("\n")}\n\n${input.feedback ? `Your last proposal was rejected: ${input.feedback}\nFix these problems.\n\n` : ""}Propose the layers.`,
  };
}
