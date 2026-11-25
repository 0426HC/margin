import { formatPassages, section, type NumberedPassage, type PromptPair } from "./shared";

/**
 * The Librarian reads what was discussed in Let's talk! and picks the passages of the student's files that the conversation
 * rests on, grouped by topic. It answers with passage numbers only; code copies the exact text out of storage.
 */
export function collectSources(input: { conversation: string; passages: NumberedPassage[]; topics: string[] }): PromptPair {
  return {
    system: `You are the Librarian. A student has been talking with their professor about their own course. Collect the sources for that conversation: the passages of their files that the discussion rests on, so they can read the real words later.
Pick only passages that clearly bear on something that was actually discussed. Group them under short topic names (two to five words, in the student's own terms). Prefer fewer, better passages: skip repetition and side detail, and skip passages that only share a word with the conversation. A topic with no good passage should not appear.${input.topics.length ? ` If a topic below already exists and fits, reuse its exact name: ${input.topics.join("; ")}.` : ""}
Answer ONLY with topic names and passage numbers. Never quote, alter or invent text yourself.`,
    prompt: `${section("The conversation", input.conversation)}\n\n${section("Passages from the student's files", formatPassages(input.passages))}\n\nWhich passage numbers, under which topics, does this conversation rest on?`,
  };
}
