import { section, type PromptPair } from "./shared";

/**
 * Quick notes: turn the student's saved write-up of a layer into short arrow-style notes to start from. It only compresses what the
 * write-up already says (nothing from outside it), keeps the student's own terms, and writes plain lines the student will edit.
 */
export function quickNotes(input: { title: string; writeup: string }): PromptPair {
  return {
    system: `You turn a student's own write-up into quick study notes they will edit. Use ONLY what the write-up says: add no facts, names, numbers or examples of your own. Keep the student's own words and terms wherever you can.
Write 4 to 9 short lines, one idea per line. Start each line with "→ ". Where one idea leads to another, use an arrow inside the line ("cause → effect"). No headings, no bold, no numbering, no citations, no intro and no closing remark. Output only the lines.`,
    prompt: `${section("Layer", input.title)}\n\n${section("The student's write-up", input.writeup)}`,
  };
}
