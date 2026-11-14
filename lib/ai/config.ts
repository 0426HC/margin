import type { Effort } from "./engine";

// Which model and effort each kind of task uses. Env variables override the defaults.
export type Task = "review" | "explain" | "structure" | "talk";

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

const DEFAULTS: Record<Task, { model: string; effort?: Effort }> = {
  // The layer chatbot: write-back and synthesis reviews, "I don't get it".
  review: { model: "claude-opus-5-5", effort: "medium" },
  // Explained and the verbatim Source picks: accuracy matters most here.
  explain: { model: "claude-opus-5-5", effort: "medium" },
  // Part split and layer breakdown proposal (you approve it before anything is written).
  structure: { model: "sonnet" },
  // Let's talk!
  talk: { model: "sonnet" },
};

export function modelFor(task: Task, env: Record<string, string | undefined> = process.env): { model: string; effort?: Effort } {
  const key = task.toUpperCase();
  const model = env[`MARGIN_MODEL_${key}`]?.trim() || DEFAULTS[task].model;
  const raw = env[`MARGIN_EFFORT_${key}`]?.trim().toLowerCase();
  if (raw === "default" || raw === "none") return { model };
  const effort = EFFORTS.includes(raw as Effort) ? (raw as Effort) : DEFAULTS[task].effort;
  return effort ? { model, effort } : { model };
}
