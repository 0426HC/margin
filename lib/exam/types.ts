export const FORMATS = ["multiple_choice", "short_answer", "essay", "problem", "other"] as const;
export type ExamFormat = (typeof FORMATS)[number];

export const FORMAT_LABEL: Record<ExamFormat, string> = { multiple_choice: "Multiple choice", short_answer: "Short answer", essay: "Essay", problem: "Problem", other: "Other" };

export interface ExamSection {
  name: string;
  format: ExamFormat;
  count: number;
  marksEach: number | null;
  instructions: string;
}

/** What an exam instruction sheet says, as far as Margin could read it. The student checks and edits it before anything is generated. */
export interface ExamSummary {
  title: string;
  date: string | null;
  lengthMinutes: number | null;
  totalMarks: number | null;
  sections: ExamSection[];
  /** Course weeks the exam covers (empty when the sheet doesn't say). */
  weeks: number[];
  topics: string[];
  markingGuide: string;
  terms: string[];
  sampleQuestions: string[];
}

/** A passage a question can be built from, kept with the set so feedback can cite exactly it. */
export interface ExamSource {
  kind: "sheet" | "past" | "lecture" | "reading";
  file: string;
  page: number;
  text: string;
}

export interface QuestionOrigin {
  kind: ExamSource["kind"];
  /** Where it came from, in the student's words: "your exam sheet", "the Week 3 lecture", "Federalist No. 10". */
  label: string;
  /** [file, p. N], checked against what was sent. */
  cite: string;
}

export interface ExamQuestion {
  id: string;
  section: number;
  format: ExamFormat;
  prompt: string;
  marks: number;
  options?: string[];
  /** Multiple choice only: the index of the right option. Marked by code. */
  correct?: number;
  /** What a good answer covers: used by the Examiner, never shown before handing in. */
  keyPoints: string[];
  builtFrom: QuestionOrigin[];
}

export interface QuestionFeedback {
  id: string;
  status: "marked" | "skipped";
  marksAwarded: number;
  marks: number;
  /** Multiple choice: marked by code. Otherwise reviewed by the Examiner. */
  by: "code" | "examiner";
  strengths: string;
  fixes: string[];
}

export interface ExamFeedback {
  results: QuestionFeedback[];
  earned: number;
  total: number;
  answered: number;
  skipped: number;
}
