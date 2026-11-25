import { splitCitations, invalidCitations } from "@/lib/ai/citations";
import type { ExamQuestionsOut } from "@/lib/ai/schemas";
import type { QuestionPlanRow } from "@/lib/ai/prompts";
import type { ExamFeedback, ExamFormat, ExamQuestion, ExamSource, ExamSummary, QuestionFeedback } from "./types";

/** Pure rules of the exam room: how many questions to write, how long they get, whether what came back can be used, and marking by code. */

/** A set is at most this many questions: enough to practise the format without taking the whole afternoon to write or sit. */
export const MAX_QUESTIONS = 30;
const DEFAULT_MARKS: Record<ExamFormat, number> = { multiple_choice: 1, short_answer: 5, essay: 15, problem: 10, other: 5 };

export interface QuestionPlan {
  rows: QuestionPlanRow[];
  /** What the real exam asks for. */
  planned: number;
  /** What a set will hold. Less than `planned` when the real exam is longer than a set. */
  built: number;
  /** The real time limit scaled to the set's size, or null when the sheet gives none. */
  minutes: number | null;
}

/** The sheet's sections as a plan for one set, shortened proportionally (keeping every section) when the real exam has more than a set holds. */
export function planQuestions(summary: ExamSummary): QuestionPlan {
  const planned = summary.sections.reduce((n, s) => n + s.count, 0);
  let counts = summary.sections.map((s) => s.count);
  if (planned > MAX_QUESTIONS) {
    counts = counts.map((c) => Math.max(1, Math.round((c * MAX_QUESTIONS) / planned)));
    while (counts.reduce((a, b) => a + b, 0) > MAX_QUESTIONS) {
      const i = counts.indexOf(Math.max(...counts));
      if (counts[i] <= 1) break;
      counts[i]--;
    }
  }
  const built = counts.reduce((a, b) => a + b, 0);
  return {
    rows: summary.sections.map((s, i) => ({ section: i + 1, name: s.name, format: s.format, count: counts[i], marksEach: s.marksEach ?? DEFAULT_MARKS[s.format], instructions: s.instructions })),
    planned,
    built,
    minutes: summary.lengthMinutes ? Math.max(1, Math.round((summary.lengthMinutes * built) / planned)) : null,
  };
}

const words = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
/** Whether two questions are nearly the same question. Used so a new set doesn't repeat an old one. */
export function tooSimilar(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return false;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both) >= 0.7;
}

const keyOf = (s: { file: string; page: number }) => `${s.file}\u0000${s.page}`;

/**
 * Check what the model wrote against the plan and the sources. Citations that point at nothing are dropped from a question's origins
 * (a question left with none is an error); counts per section must match; multiple choice needs options and one right answer.
 */
export function checkQuestions(out: ExamQuestionsOut, plan: QuestionPlan, sent: { file: string; page: number }[], avoid: string[]): { questions: ExamQuestion[]; errors: string[] } {
  const errors: string[] = [];
  const sentSet = new Set(sent.map(keyOf));
  const bySection = new Map<number, ExamQuestionsOut["questions"]>();
  for (const q of out.questions) bySection.set(q.section, [...(bySection.get(q.section) ?? []), q]);
  const questions: ExamQuestion[] = [];
  for (const row of plan.rows) {
    const got = bySection.get(row.section) ?? [];
    if (got.length !== row.count) errors.push(`Section ${row.section} needs exactly ${row.count} questions, and you wrote ${got.length}.`);
    for (const q of got.slice(0, row.count)) {
      const label = `Section ${row.section} question "${q.prompt.slice(0, 40)}…"`;
      const mc = row.format === "multiple_choice";
      if (mc && (!q.options || q.options.length < 2 || q.correct === undefined || q.correct >= q.options.length)) errors.push(`${label} is multiple choice, so it needs options and the index of the one right option.`);
      if (!mc && q.options?.length) errors.push(`${label} is not multiple choice, so it must not have options.`);
      const origins = q.builtFrom.filter((o) => invalidCitations(o.cite, sent).length === 0 && splitCitations(o.cite).some((p) => "cite" in p && sentSet.has(keyOf(p.cite))));
      if (!origins.length) errors.push(`${label} cites nothing that was in the sources. Cite only a file and page that were given.`);
      if (avoid.some((a) => tooSimilar(a, q.prompt))) errors.push(`${label} repeats an earlier question. Ask about different ground.`);
      questions.push({ id: "", section: row.section, format: row.format, prompt: q.prompt.trim(), marks: row.marksEach, ...(mc ? { options: q.options, correct: q.correct } : {}), keyPoints: q.keyPoints, builtFrom: origins });
    }
  }
  questions.forEach((q, i) => (q.id = `q${i + 1}`));
  return { questions, errors: [...new Set(errors)] };
}

/** Multiple choice is marked by code: the right option earns the question's marks, anything else nothing. */
export function markChoice(q: ExamQuestion, answer: string | undefined): QuestionFeedback {
  const picked = answer === undefined || answer === "" ? null : Number(answer);
  if (picked === null || Number.isNaN(picked)) return { id: q.id, status: "skipped", marksAwarded: 0, marks: q.marks, by: "code", strengths: "", fixes: [] };
  const right = picked === q.correct;
  const correct = q.options?.[q.correct ?? -1] ?? "";
  return { id: q.id, status: "marked", marksAwarded: right ? q.marks : 0, marks: q.marks, by: "code", strengths: right ? "Correct." : "", fixes: right ? [] : [`The right answer is “${correct}”.`] };
}

/** Add up the results: marks earned of marks available, and how many were answered or skipped. */
export function tally(results: QuestionFeedback[], questions: ExamQuestion[]): ExamFeedback {
  const total = questions.reduce((n, q) => n + q.marks, 0);
  return {
    results,
    earned: Math.round(results.reduce((n, r) => n + r.marksAwarded, 0) * 2) / 2,
    total,
    answered: results.filter((r) => r.status === "marked").length,
    skipped: results.filter((r) => r.status === "skipped").length,
  };
}

/** The sources a question's feedback may cite: the ones its origins name. */
export function sourcesFor(q: ExamQuestion, sources: ExamSource[]): ExamSource[] {
  const wanted = new Set(q.builtFrom.flatMap((o) => splitCitations(o.cite).flatMap((p) => ("cite" in p ? [keyOf(p.cite)] : []))));
  return sources.filter((s) => wanted.has(keyOf(s)));
}
