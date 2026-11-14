import { BEYOND, GROUNDING, formatPassages, section, type NumberedPassage, type Passage, type PromptPair } from "./shared";

export interface LayerRef {
  title: string;
  bigQuestion: string;
}

/** Choose which of a layer's passages its explanation rests on. Returns numbers only; code copies the exact text. */
export function pickSource(input: { layer: LayerRef; passages: NumberedPassage[] }): PromptPair {
  return {
    system: `You choose the source passages for one layer of a course. The student will read an explanation of the layer and then check it against these exact passages, so choose every passage the explanation must rest on: the ones that define the key terms, name the people and cases, and make the central argument. Leave out passages that are only repetition or side detail. Answer ONLY with passage numbers, in reading order. Never alter or quote the text yourself.`,
    prompt: `${section("Layer", `${input.layer.title}\nBig question: ${input.layer.bigQuestion}`)}\n\n${section("Passages", formatPassages(input.passages))}\n\nWhich passage numbers does this layer's explanation rest on?`,
  };
}

/** The Explained tab. Every rule in the student's brief is in the system prompt. */
export function explainLayer(input: { layer: LayerRef; passages: Passage[]; previous?: LayerRef; next?: LayerRef }): PromptPair {
  return {
    system: `You write the "Explained" tab for one layer of a course, for a student who will then write the layer back in their own words.
${GROUNDING}
${BEYOND}

Style, all required:
- Start from the basics underneath the concept, before course terms. Assume the student has never met the idea.
- Explain every name, author, case or term the first time it appears: who or what it is and why it matters. Never drop an unexplained name.
- Use concrete examples. Use an analogy only if it really holds up.
- Organise by topic, as short headed sections with bullets. Use a table for any typology (for example a 2x2 with an explanation in each cell). No story or narrative format.
- End the blocks, then give the layer's key "so what": how it connects to the bigger argument and to other layers.
- Plain English, short sentences, no filler.
Output blocks of these types only: heading, paragraph, bullets, table. Every paragraph, every bullet and every table (in its source field) carries at least one [file, p. N] citation.`,
    prompt: `${section("Layer", `${input.layer.title}\nBig question: ${input.layer.bigQuestion}`)}\n${input.previous ? `\nPrevious layer: ${input.previous.title} (${input.previous.bigQuestion})` : ""}${input.next ? `\nNext layer: ${input.next.title} (${input.next.bigQuestion})` : ""}\n\n${section("Passages", formatPassages(input.passages))}\n\nWrite the explanation.`,
  };
}
