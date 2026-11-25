export interface Passage {
  file: string;
  page: number;
  text: string;
  /** From an optional reading, not required material. The model must say so when it uses it. */
  optional?: boolean;
}
export interface NumberedPassage extends Passage {
  n: number;
}
export interface PromptPair {
  system: string;
  prompt: string;
}

export const GROUNDING = `Use ONLY the course passages you are given. Never invent names, dates, numbers, quotes or page numbers. Cite every factual claim as [file, p. N], using exactly a file name and page that appear in the passages. Keep names, dates and numbers exactly as the passages give them. A passage marked "(optional reading)" is not required material: use it only to go further, and say it comes from an optional reading when you do.`;

export const BEYOND = `If something needed is not in the passages, say so plainly. Only if general knowledge is genuinely needed, label it "Beyond your files:".`;

/** Passages as `[file, p. N]` blocks, optionally numbered `#n` so the model can refer to them by number. */
export function formatPassages(passages: (Passage | NumberedPassage)[]): string {
  return passages.map((p) => `${"n" in p ? `#${p.n} ` : ""}[${p.file}, p. ${p.page}]${p.optional ? " (optional reading)" : ""}\n${p.text}`).join("\n\n");
}

export const section = (title: string, body: string) => `## ${title}\n${body}`;
