import { z } from "zod";
import { FORMATS } from "@/lib/exam/types";

const text = (max: number) => z.string().trim().max(max);

/** What an exam sheet says. Also the shape the student edits and saves, so the same checks apply to both. */
export const examSummarySchema = z.object({
  title: text(80).min(1),
  date: text(60).nullable(),
  lengthMinutes: z.number().int().min(1).max(600).nullable(),
  totalMarks: z.number().min(0).max(1000).nullable(),
  sections: z
    .array(z.object({ name: text(80).min(1), format: z.enum(FORMATS), count: z.number().int().min(1).max(100), marksEach: z.number().min(0).max(200).nullable(), instructions: text(600) }))
    .min(1)
    .max(12),
  weeks: z.array(z.number().int().min(1).max(60)).max(60),
  topics: z.array(text(120).min(1)).max(40),
  markingGuide: text(4000),
  terms: z.array(text(80).min(1)).max(60),
  sampleQuestions: z.array(text(600).min(1)).max(20),
});

const cite = z.string().regex(/\[[^\]\n]+, p\. \d+\]/, "a [file, p. N] citation");

/** Practice questions. Each says which section of the sheet it belongs to and what it was built from; code checks the numbers and the citations. */
export const examQuestionsSchema = z.object({
  questions: z
    .array(
      z.object({
        section: z.number().int().min(1),
        prompt: text(1500).min(8),
        options: z.array(text(300).min(1)).min(2).max(6).optional(),
        correct: z.number().int().min(0).max(5).optional(),
        keyPoints: z.array(text(300).min(1)).max(10),
        builtFrom: z.array(z.object({ kind: z.enum(["sheet", "past", "lecture", "reading"]), label: text(120).min(1), cite })).min(1).max(4),
      }),
    )
    .min(1)
    .max(60),
});
export type ExamQuestionsOut = z.infer<typeof examQuestionsSchema>;

/** The Examiner's feedback on the answered, non-multiple-choice questions. Marks are clamped by code to what each question is worth. */
export const examFeedbackSchema = z.object({
  results: z
    .array(z.object({ id: z.string().min(1), marksAwarded: z.number().min(0).max(200), strengths: text(500), fixes: z.array(text(500).min(1)).max(8) }))
    .max(60),
});
export type ExamFeedbackOut = z.infer<typeof examFeedbackSchema>;
