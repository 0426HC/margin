import type { PromptPair } from "./shared";

/** One passage of a week, with its full text. `part` marks where a court case's part (an opinion, a dissent) begins. */
export interface WeekPassage {
  n: number;
  file: string;
  page: number;
  /** "Reading" or "Lecture". */
  role: string;
  section: string;
  words: number;
  text: string;
  part?: string | null;
}

/**
 * Propose the layers of one week: the chain of ideas the week's material teaches, each building on the one before. The model reads the
 * full text of every passage, numbered and grouped under its file and section, with the week's title and what the syllabus says about it.
 */
export function weekLayers(input: {
  course: string;
  /** "Week 3 · Congress". */
  week: string;
  /** What the syllabus says about this week (its topic and readings), if anything. */
  syllabus?: string | null;
  passages: WeekPassage[];
  /** 2 for a week with enough material to need two layers; 1 for a very light week. */
  minLayers: 1 | 2;
  /** Why the last proposal was rejected, so it can be fixed. */
  feedback?: string;
}): PromptPair {
  const total = input.passages.reduce((n, p) => n + p.words, 0);
  const lines: string[] = [];
  let at = "";
  for (const p of input.passages) {
    const head = `${p.file} · ${p.role} · ${p.section}`;
    if (head !== at) {
      const run = input.passages.filter((q) => `${q.file} · ${q.role} · ${q.section}` === head);
      lines.push(`\n== ${head} (${run.reduce((n, q) => n + q.words, 0).toLocaleString("en-US")} words)`);
      at = head;
    }
    lines.push(`#${p.n} | p. ${p.page} | ${p.words} words${p.part ? ` | STARTS: ${p.part}` : ""}\n${p.text}`);
  }
  const count = input.minLayers === 2 ? "2 to 5 layers" : "1 to 5 layers (this week is very light, so 1 is allowed)";
  return {
    system: `You plan how a student will learn one week of a university course, layer by layer. Read the week's material in full and work out the CHAIN OF IDEAS it teaches, using all of it (readings and lecture material alike). Make one layer per idea.
Rules:
- ${count}. Never more than 5. The number follows the ideas, not the page count.
- Together the layers must cover everything important in the week's material: they are not summaries and nothing important is dropped. When a week is heavy, keep it to 5 layers and let each layer cover more (up to about 10,000 words of material each) rather than adding layers.
- Order the layers so each builds on the one before. Each has a short title, the ONE big question it answers (a real question ending in "?"), and one line on how it builds on the previous layer (empty for the first).
- A layer is made of passages, referred to by their numbers, as one or more inclusive ranges. An idea that runs through a reading and the lecture takes ranges from both. Every passage belongs to exactly one layer: none in two layers, none left out.
- A long text never goes into one giant layer: split it across layers by its real parts. A court case splits into its facts, the majority opinion, concurrences and dissents (the lines marked STARTS show where these begin); a book chapter by its sections or its argument's steps.
- Never make two layers about the same idea.
- Use only the passages given. Do not invent ideas that are not there.`,
    prompt: `Course: ${input.course}
${input.week}${input.syllabus ? `\nThe syllabus says about this week: ${input.syllabus}` : ""}
This week's material: ${input.passages.length} passages, ${total.toLocaleString("en-US")} words.

Passages, in full, grouped by file and section (number | page | length, then the text):
${lines.join("\n")}

${input.feedback ? `Your last proposal was rejected: ${input.feedback}\nFix these problems.\n\n` : ""}Propose this week's layers.`,
  };
}
