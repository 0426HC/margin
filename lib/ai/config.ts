import type { Effort } from "./engine";

// Which model and effort each kind of task uses. Env variables override the defaults.
export type Task = "review" | "explain" | "organize" | "check" | "structure" | "talk" | "lecture" | "notes" | "exam" | "request" | "brain";

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

const DEFAULTS: Record<Task, { model: string; effort?: Effort }> = {
  // The layer chatbot: write-back and synthesis reviews, "I don't get it".
  review: { model: "claude-opus-5-5", effort: "medium" },
  // Explained (streamed into the page), its section fixes and the verbatim Source picks. Opus for accuracy, at low effort for speed: on a
  // real 10,000-word layer low effort showed its first words after about 7 seconds against 21-30 at medium, with the same length and plain,
  // cited teaching; the check-and-fix round (lib/layers/explained-check.ts) catches what a quick first pass misses.
  explain: { model: "claude-opus-5-5", effort: "low" },
  // Import: reading the syllabus and the folder to give every file its week and type, and the course its weeks. One call per course.
  organize: { model: "claude-opus-5-5", effort: "medium" },
  // Import, last step: one look over the whole sorted course (do the weeks, folders and syllabus agree?). A common-sense check of a
  // result, not a fresh reading, so low effort.
  check: { model: "claude-opus-5-5", effort: "low" },
  // The course plan: each week's chain of ideas as layers, read from the full text of the week (you approve it before anything is
  // written). Also placing new files into the plan. The most important judgement Margin makes, so Opus at medium effort.
  structure: { model: "claude-opus-5-5", effort: "medium" },
  // Let's talk!
  talk: { model: "sonnet" },
  // The Lecture tab of a layer: written like Explained, so it gets the same model and effort.
  lecture: { model: "claude-opus-5-5", effort: "medium" },
  // The exam room: reading the sheet, writing the practice questions, and the Examiner's feedback on answers.
  exam: { model: "claude-opus-5-5", effort: "medium" },
  // A document an agent makes from a note the student leaves on the overview (study guide, checklist, connections).
  request: { model: "claude-opus-5-5", effort: "medium" },
  // Choosing which of the student's own lecture notes belong to a layer (the lines themselves are copied by code).
  notes: { model: "sonnet" },
  // The course brain: reading every course file in full, in the background, and writing notes on what matters in it. Many calls, so Sonnet.
  brain: { model: "sonnet" },
};

export function modelFor(task: Task, env: Record<string, string | undefined> = process.env): { model: string; effort?: Effort } {
  const key = task.toUpperCase();
  const model = env[`MARGIN_MODEL_${key}`]?.trim() || DEFAULTS[task].model;
  const raw = env[`MARGIN_EFFORT_${key}`]?.trim().toLowerCase();
  if (raw === "default" || raw === "none") return { model };
  const effort = EFFORTS.includes(raw as Effort) ? (raw as Effort) : DEFAULTS[task].effort;
  return effort ? { model, effort } : { model };
}
