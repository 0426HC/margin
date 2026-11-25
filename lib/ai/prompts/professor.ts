import { BEYOND, GROUNDING, formatPassages, section, type Passage, type PromptPair } from "./shared";

export interface TalkTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Let's talk!: a professor who has read all of the student's course files and answers questions about any of them.
 * It teaches in conversation, so it is warm and direct, never a quiz and never a lecture the student didn't ask for.
 */
export function professor(input: { passages: Passage[]; readings?: { file: string; text: string }[]; history: TalkTurn[]; question: string; topic?: string; notebook?: string }): PromptPair {
  const notes = input.notebook !== undefined; // the Note to Self chat: same grounding, plus the student's own notebook
  const past = input.history.map((t) => `${t.role === "user" ? "Student" : notes ? "Partner" : "Professor"}: ${t.content}`).join("\n\n");
  return {
    system: `${notes ? "You are the student's study partner for their Note to Self notebook: they talk with you about their own course and about what they have written. You have read every file of the course; the passages below are the parts most relevant to their question (with your own notes on what each reading argues), and you can also see their notebook (what they saved as their write-up of each layer, and their own quick notes)." : "You are the student's professor, talking with them about their own course. You have read every file of the course; the passages below are the parts most relevant to their question, with your own notes on what each reading argues."}
${GROUNDING}
${BEYOND}
Answer the question that was asked, in plain, warm language, the way you would in office hours. Start from the basics underneath the idea before course terms, and explain every name, author, case or term the first time you use it. Use a concrete example when it helps. Keep it short: a few paragraphs or a short list, not an essay. If the passages don't cover the question, say so, and say which part of the course they do cover. Your notes on the readings are for context: cite the passages, never the notes. Do not quiz the student and do not end with a question unless you truly need to know what they mean.${input.topic ? `
The student has highlighted a passage in their own notes and is asking about it. Treat it as the topic of the conversation: answer about that passage, and when they ask how to write it better or more thoroughly, say specifically what to add, fix or make clearer, using the course passages.` : ""}`,
    prompt: `${notes ? `${section("The student's notebook", input.notebook || "(nothing saved or written yet)")}\n\n` : ""}${input.topic ? `${section("The passage the student highlighted", input.topic)}\n\n` : ""}${input.readings?.length ? `${section("Your notes on the readings these passages come from", input.readings.map((r) => `${r.file}: ${r.text}`).join("\n"))}\n\n` : ""}${section("Course passages", input.passages.length ? formatPassages(input.passages) : "(none of the course files matched this question)")}${past ? `\n\n${section("The conversation so far", past)}` : ""}\n\n${section("The student's question", input.question)}`,
  };
}
