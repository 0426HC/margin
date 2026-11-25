import { GROUNDING, formatPassages, section, type Passage, type PromptPair } from "./shared";
import type { ExamSummary } from "@/lib/exam/types";
import { FORMAT_LABEL } from "@/lib/exam/types";

/** Read an exam instruction sheet into a structured summary. Nothing is invented: what the sheet does not say is left empty or null. */
export function readExamSheet(input: { fileName: string; text: string; courseWeeks: number }): PromptPair {
  return {
    system: `You read an exam instruction sheet for a student and summarise it as structured data, so the student can check it before practising.
Rules:
- Use ONLY what the sheet says. If it does not say something, use null, an empty list or an empty string. Never guess a date, a mark or a count.
- sections: one entry per part of the paper (for example "Section A"), with its format (multiple_choice, short_answer, essay, problem, or other), how many questions it has, the marks for each question if given, and any instruction for that part. If the sheet gives only a total for a section, set marksEach to that total divided by the count, rounded to one decimal.
- weeks: the course weeks the exam covers, as numbers 1 to ${input.courseWeeks}, only if the sheet names weeks (or a range such as "weeks 1 to 6") or units that clearly are weeks.
- topics: topics, readings or units the sheet says are covered.
- markingGuide: how the sheet says answers are marked (criteria, what earns marks), kept close to its own words.
- terms: key terms the sheet lists. sampleQuestions: any sample or example questions it lists, copied as written.
- lengthMinutes: the time allowed, in minutes.`,
    prompt: `${section("The sheet", `${input.fileName}\n\n${input.text}`)}\n\nSummarise the sheet.`,
  };
}

/**
 * Update an exam's details from an updated sheet and/or a note of what the student heard. The answer is the whole summary again: unchanged
 * fields copied exactly, changed ones updated, so code can show the student every difference before anything is saved.
 */
export function updateExamDetails(input: { current: ExamSummary; sheet: { fileName: string; text: string } | null; note: string; courseWeeks: number }): PromptPair {
  return {
    system: `You update the details of a student's exam. You get the details as they are now, and an updated exam sheet, a note of what the student heard (for example from the professor), or both.
Rules:
- Return the WHOLE details again in the same shape. Copy every field that the sheet and the note do not change exactly as it is now, word for word.
- Change only what the updated sheet or the note clearly says is different. Never guess. If they do not mention something, leave it as it is.
- When a change touches one part of the paper (for example "Part II will have three essay choices"), change only that part: its instructions, count or marks.
- Keep the student's own wording in instructions where you can, changing only the words that are now wrong.
- weeks are numbers 1 to ${input.courseWeeks}. lengthMinutes is in minutes.`,
    prompt: [
      section("The details now", JSON.stringify(input.current, null, 2)),
      input.sheet ? section("The updated sheet", `${input.sheet.fileName}\n\n${input.sheet.text}`) : "",
      input.note.trim() ? section("What the student heard", input.note.trim()) : "",
      "Return the updated details.",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

export interface QuestionPlanRow {
  section: number;
  name: string;
  format: ExamSummary["sections"][number]["format"];
  count: number;
  marksEach: number;
  instructions: string;
}

/** Write a practice exam in the sheet's real format, built only from the sources given. */
export function writeExamQuestions(input: {
  summary: ExamSummary;
  plan: QuestionPlanRow[];
  /** What the lectures stressed, counted by Margin. */
  stressed: string;
  sources: Passage[];
  /** Questions from earlier sets, so this one covers different ground. */
  avoid: string[];
  /** Layers the student is weaker on, so the set leans toward them. */
  weaker: string[];
  feedback?: string;
}): PromptPair {
  const { summary } = input;
  const rows = input.plan.map((p) => `${p.section} | ${FORMAT_LABEL[p.format]} | ${p.count} question${p.count === 1 ? "" : "s"} | ${p.marksEach} mark${p.marksEach === 1 ? "" : "s"} each | ${p.name}${p.instructions ? `: ${p.instructions}` : ""}`);
  return {
    system: `You write a practice exam for a student, in the REAL format of their exam sheet, from their own course material.
${GROUNDING}
Rules:
- Write exactly the number of questions the plan asks for in each section, in the format of that section. Multiple choice: 4 options, exactly one right, and "correct" is the index (starting at 0) of the right option; the wrong options must be plausible but clearly wrong from the sources. Short answer, essay and problem questions have no options.
- Questions come ONLY from the sources: the exam sheet and sample questions, past or practice exams, what the lectures stressed, and the course passages. Never from general knowledge. Never invent names, cases, numbers or quotes.
- These are practice questions in the exam's format. They are not predictions of the real exam, so never say or imply that they are.
- Every question has builtFrom: one to three origins, each with its kind (sheet, past, lecture or reading), a short label in plain words, and a [file, p. N] citation using exactly a file name and page that appear in the sources.
- keyPoints: what a good answer covers (two to six short points) for the Examiner, written from the sources. For multiple choice, one point saying why the right option is right.
- Match the difficulty and style of the sample questions and past exams, if there are any. Cover different ground from the questions to avoid, and lean toward the weaker layers listed.`,
    prompt: `${section("The exam", `${summary.title}${summary.lengthMinutes ? `, ${summary.lengthMinutes} minutes` : ""}${summary.markingGuide ? `\nMarking guide: ${summary.markingGuide}` : ""}`)}\n\n${section("Plan: section | format | how many | marks | name", rows.join("\n"))}\n\n${section("What the lectures stressed (counted by Margin)", input.stressed || "(no lecture material in the covered weeks)")}\n\n${input.weaker.length ? `${section("Weaker layers: lean toward these", input.weaker.map((w) => `- ${w}`).join("\n"))}\n\n` : ""}${input.avoid.length ? `${section("Questions to avoid repeating", input.avoid.map((a) => `- ${a}`).join("\n"))}\n\n` : ""}${section("Sources", formatPassages(input.sources))}\n\n${input.feedback ? `Your last answer was rejected: ${input.feedback}\nFix these problems.\n\n` : ""}Write the practice exam.`,
  };
}

export interface ToExamine {
  id: string;
  prompt: string;
  marks: number;
  keyPoints: string[];
  answer: string;
}

/** The Examiner marks the student's answers against the sheet's marking guide, with specific fixes and citations. */
export function examineAnswers(input: { markingGuide: string; questions: ToExamine[]; sources: Passage[] }): PromptPair {
  return {
    system: `You are the Examiner. You mark a student's practice-exam answers against the exam sheet's marking guide, as a fair, specific tutor.
${GROUNDING}
Rules:
- For each question give marksAwarded (a number from 0 up to the marks it is worth; half marks are fine), strengths (one short sentence on what the answer did well, or an empty string), and fixes: specific things to add or correct, each tied to the key points and the sources, citing [file, p. N] for every factual correction using only the sources given.
- Mark against the key points and the marking guide, not against your own opinion. Do not reward length. An answer that is mostly wrong gets few marks and says why.
- Never invent facts, quotes or page numbers. Do not rewrite the student's answer.
- Return one result per question id given, no others.`,
    prompt: `${section("Marking guide", input.markingGuide || "(the sheet gives no marking guide: mark on accuracy, use of the course material and clarity)")}\n\n${section("Sources", formatPassages(input.sources))}\n\n${section("Answers to mark", input.questions.map((q) => `### ${q.id} (${q.marks} marks)\nQuestion: ${q.prompt}\nKey points: ${q.keyPoints.join("; ")}\nStudent's answer: ${q.answer}`).join("\n\n"))}\n\nMark these answers.`,
  };
}
