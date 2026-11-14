import { BEYOND, GROUNDING, formatPassages, section, type Passage, type PromptPair } from "./shared";
import type { LayerRef } from "./layer-content";

const REVIEW_RULES = `You review a student's write-back. The student wrote this in their own words to learn the material, so you are a careful tutor, not a rewriter.
${GROUNDING}
${BEYOND}

Reply with exactly these parts:
1. fixes: a short list of SPECIFIC fixes. Each has a kind: fact (a factual error), term (a wrong term), name (a wrong or misattributed name), missing (a key term, name or idea that is missing), vague (an unclear or vague sentence), or grammar. Quote the student's words you mean. For every fact, term, name or missing fix, say what the passages say and cite [file, p. N]. Do not nitpick: only fixes that matter.
2. cleanedUp: the student's OWN writing, corrected. Keep their wording, order and voice wherever it is not wrong or unclear. Fix errors, add a missing term only where needed, repair grammar. Do not rewrite it in your own style and do not add new material.
3. soWhat: exactly one sentence linking this to the bigger argument.
4. verdict: "approved" only if there are no factual, term, name or missing-content problems and the writing is clear. Otherwise "needs_work". If you approve, fixes may only be minor grammar or vague-wording notes, or empty.`;

export const STRICT_NOTE = `\n\nYour last cleanedUp changed too much of the student's wording. Keep at least 60% of their own words, in their order. Change only what is wrong or unclear.`;

export interface ReviewHistory {
  /** Set on the retry after a cleaned-up version drifted from the student's own wording. */
  strict?: boolean;
  /** The student's earlier submission and the fixes you asked for, so you can check they were made. */
  previousWriting?: string;
  previousFixes?: string[];
}

export function reviewWriteback(input: { layer: LayerRef; passages: Passage[]; writing: string } & ReviewHistory): PromptPair {
  return {
    system: REVIEW_RULES + (input.strict ? STRICT_NOTE : ""),
    prompt: `${section("Layer", `${input.layer.title}\nBig question: ${input.layer.bigQuestion}`)}\n\n${section("Course passages", formatPassages(input.passages))}${history(input)}\n\n${section("The student's write-back", input.writing)}`,
  };
}

/** The Part synthesis: one combined piece pulling the layers together. */
export function reviewSynthesis(input: { part: "A" | "B"; layers: (LayerRef & { final?: string })[]; passages: Passage[]; writing: string } & ReviewHistory): PromptPair {
  const layers = input.layers.map((l, i) => `${i + 1}. ${l.title}: ${l.bigQuestion}${l.final ? `\n   What the student saved to Note to Self for this layer: ${l.final}` : "\n   (the student has not saved this layer yet)"}`).join("\n");
  return {
    system: `${REVIEW_RULES}${input.strict ? STRICT_NOTE : ""}\n\nThis is the synthesis of a whole Part: judge whether it pulls the layers together into one argument, not just lists them. A "missing" fix can be a layer or a link between layers that the synthesis leaves out.`,
    prompt: `${section(`Part ${input.part}: its layers`, layers)}\n\n${section("Course passages", formatPassages(input.passages))}${history(input)}\n\n${section("The student's synthesis", input.writing)}`,
  };
}

function history(h: ReviewHistory): string {
  if (!h.previousWriting) return "";
  return `\n\n${section("Their earlier attempt, and what you asked them to fix", `${h.previousWriting}\n\nFixes you asked for:\n${(h.previousFixes ?? []).map((f) => `- ${f}`).join("\n") || "- (none recorded)"}\nCheck whether these were fixed, and do not repeat fixes that were.`)}`;
}

/** "I don't get it": explain again, simpler or from a more basic level, then ask for another try. Streamed text. */
export function reexplain(input: { layer: LayerRef; passages: Passage[]; writing?: string; confusion?: string; attempt: number }): PromptPair {
  return {
    system: `A student said they don't get a layer of their course. Explain it again, more simply and from a more basic level than before${input.attempt > 1 ? " (this is attempt " + input.attempt + ", so go one step more basic still)" : ""}.
${GROUNDING}
${BEYOND}
Start from everyday ideas underneath the concept. Explain every name and term when it first appears. Use one concrete example. Short sentences, no lists longer than four items, no story. Then end by asking the student to try writing the layer back again in their own words, and say which one or two ideas to start with.`,
    prompt: `${section("Layer", `${input.layer.title}\nBig question: ${input.layer.bigQuestion}`)}\n\n${section("Course passages", formatPassages(input.passages))}${input.confusion ? `\n\n${section("What the student said they don't get", input.confusion)}` : ""}${input.writing ? `\n\n${section("Their latest attempt", input.writing)}` : ""}`,
  };
}
