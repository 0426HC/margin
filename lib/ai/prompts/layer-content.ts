import { requiredNotes, type LayerNote } from "@/lib/layers/explained-check";
import { formatPassages, section, type NumberedPassage, type Passage, type PromptPair } from "./shared";

export interface LayerRef {
  title: string;
  bigQuestion: string;
}

/** Choose which of a layer's passages its explanation rests on. Returns numbers only; code copies the exact text. */
export function pickSource(input: { layer: LayerRef; passages: NumberedPassage[] }): PromptPair {
  return {
    system: `You choose the source passages for one layer of a course. The student will read an explanation of the layer and then check it against these exact passages, so choose every passage the explanation must rest on: the ones that define the key terms, name the people and cases, and make the central argument. Leave out passages that are only repetition or side detail. Answer ONLY with passage numbers, in reading order. Never alter or quote the text yourself.`,
    prompt: `${section("Layer", `${input.layer.title}\nBig question: ${input.layer.bigQuestion}`)}\n\n${section("Passages", formatPassages(input.passages))}\n\nWhich passage numbers does this layer's explanation rest on?`,
  };
}

const noteLine = (n: LayerNote) => `- ${n.name}${n.aliases.length ? ` (also: ${n.aliases.join("; ")})` : ""} [${n.kind}]: ${n.what}`;

/** How every named thing is taught: inside the explanation, where it matters, never as a list of terms. Shared by every Explained prompt. */
const TEACHING = `Every named concept, person, case, event, place and term is explained inside the sections, at the point where it matters, as part of answering that section's question: what it is, an example from the reading (cited), and why it matters for the question, in plain words. Weave it into the sentences. Never write a glossary, a list of terms, a "key terms" section or a table of definitions: a word bank is the opposite of how the student learns.`;

const CITING = `Citations and facts:
- Every fact, name, date, number and every claim about what a reading says carries a citation [file, p. N], using exactly a file name and page that appear in the passages. Sentences of analysis or explanation (why something happened, what it shows, how two ideas connect) need no citation, but they must rest on the cited material, never on outside facts. Never invent a name, date, number, quote or page. If general knowledge is genuinely needed to explain a basic, label it "Beyond your files:".
- Put the citation at the end of the sentence it supports. Never write a paragraph or bullet that is only a citation.`;

const STYLE = `Style:
- Plain words, short sentences, no filler. Assume the student has never met the idea. Start each section from the basics underneath it.
- Paragraphs of 2-5 sentences and, where it helps, short bullet lists. Use a table only for a typology (for example a 2x2), with an explanation in each cell, never a single word. No story or narrative format. An analogy only if it really holds up.
- Never a summary or close paraphrase of the reading: do not follow the text sentence by sentence, do not reuse its phrasing, do not quote it.
- No bold, no italics, no emoji.`;

const FORMAT = `Write plain text in exactly this format, nothing before or after it:

# Summary
(2 or 3 plain sentences giving the gist of the whole layer, no citations)

## (the first sub-question, as a real question a student would ask)
(paragraphs, separated by blank lines; bullets start with "- ")

## (the next sub-question)
(…)

# So what
(2 to 4 sentences)

A table, only for a typology, goes inside a section as a line "Table: caption" followed by Markdown table rows.`;

/**
 * The Explained tab: a teacher's explanation and analysis of one layer, not a summary. Written as streamed text in the format of
 * `lib/layers/explained-text.ts`, so the student starts reading while it is written. Code checks it (`lib/layers/explained-check.ts`).
 */
export function explainLayer(input: {
  course: string;
  week: { label: string; syllabus: string | null };
  layer: LayerRef;
  passages: Passage[];
  /** The brain's notes on the layer's passages; empty while the brain hasn't read its files. */
  notes: LayerNote[];
  readings?: { file: string; text: string }[];
  previous?: LayerRef;
  next?: LayerRef;
  length: { target: number; max: number; min: number };
}): PromptPair {
  const must = requiredNotes(input.notes, input.length.target);
  const once = input.notes.filter((n) => !must.includes(n));
  // Claude runs long when given only a total, so the length is given section by section too, and set a little under the share: on real
  // layers it writes about a fifth over the words it is given, which lands it on the share
  const sections = Math.min(6, Math.max(3, Math.round((input.length.target - 110) / 230)));
  const perSection = Math.max(70, Math.round(((input.length.target * 0.85 - 110) / sections) / 10) * 10);
  const named = input.notes.length
    ? `${section("Named in these passages: explain every one where it matters (your notes from reading the course)", must.length ? must.map(noteLine).join("\n") : "(none found more than once)")}${once.length ? `\n\n${section("Also named: say in a few words what each is where it comes up, if the section uses it", once.map(noteLine).join("\n"))}` : ""}`
    : section("Named in these passages", "Margin hasn't finished its own notes on these files: find every named concept, person, case and term in the passages yourself and explain each where it matters.");
  return {
    system: `You write the "Explained" tab for one layer of a university course: the explanation a very good teacher gives before the student reads closely and then writes the layer back in their own words. It teaches and analyses: it says how and why things happened and how the reading's argument works, not only what it says.

Why it matters: Margin is a study app built on one method. The student starts from the foundation underneath the course, learns one layer at a time, checks every claim against their own files, and must then explain the layer back. So the explanation must start from the basics a student is missing and give them the understanding they need to write it back themselves.

The shape, all required:
1. Summary: 2 or 3 plain sentences giving the gist of the whole layer.
2. The layer's big question is shown next by Margin; you don't repeat it.
3. Sections: 3 to 6, each answering one sub-question of the big question; the sub-question is the section's heading ("Why did the Ottomans rely on Greek merchants?"). Together they answer the big question step by step, each building on the last. In each, explain how and why: causes, mechanisms, consequences, how the author argues and with what evidence.
4. So what: 2-4 sentences on how the answer links to the week's question (${input.week.label}) and to the course as a whole. It may refer to the layers before and after.

${TEACHING} The list of names in the prompt is your checklist: every entry in the first list must be explained in a section.

${CITING}
- Your notes on the concepts and readings are for checking you cover everything; cite the passages, never the notes.

${STYLE}

Length: the summary, sections and so what together run to about ${input.length.target} words, never more than ${input.length.max}: this layer's share of about 4,000 words for its whole week. That is a summary of about 50 words, ${sections} sections of about ${perSection} words each, and a so what of about 60. Keep to it: explain each name compactly, in a sentence or two where it matters, rather than writing at length about a few.

${FORMAT}`,
    prompt: `${section("Course", input.course)}

${section("The week", `${input.week.label}${input.week.syllabus ? `\nWhat the syllabus says: ${input.week.syllabus}` : ""}`)}

${section("Layer", `${input.layer.title}\nBig question: ${input.layer.bigQuestion}`)}${input.previous ? `\nPrevious layer: ${input.previous.title} (${input.previous.bigQuestion})` : ""}${input.next ? `\nNext layer: ${input.next.title} (${input.next.bigQuestion})` : ""}

${named}
${input.readings?.length ? `\n${section("Your notes on the readings", input.readings.map((r) => `${r.file}: ${r.text}`).join("\n"))}\n` : ""}
${section("Passages", formatPassages(input.passages))}

Write the explanation.`,
  };
}

/** One section of a written Explained, sent back with what is wrong with it. Only that section is written again; the rest stays. */
export function fixSection(input: {
  layer: LayerRef;
  /** The whole Explained as text, so the section still fits the ones around it. */
  explained: string;
  section: string;
  problems: string[];
  passages: Passage[];
  /** The words this section should come to, when its length is part of the problem. */
  words?: number;
}): PromptPair {
  return {
    system: `You fix one section of the "Explained" tab of a layer of a university course: a teacher's explanation that answers the section's sub-question, how and why, in plain words. Write that one section again so the problems listed are gone. Keep its sub-question, its point and everything in it that is right; change only what the problems need.

${TEACHING}

${CITING}

${STYLE}

Answer with the section only, in this format and nothing else:

## (the section's sub-question)
(paragraphs separated by blank lines; bullets start with "- ")`,
    prompt: `${section("Layer", `${input.layer.title}\nBig question: ${input.layer.bigQuestion}`)}

${section("The whole explanation, for context", input.explained)}

${section("The section to write again", input.section)}

${section("What is wrong with it", input.problems.map((p) => `- ${p}`).join("\n"))}${input.words ? `\n\nWrite it in about ${input.words} words.` : ""}

${section("Passages", formatPassages(input.passages))}

Write the section again.`,
  };
}

/**
 * Named things the written Explained leaves unexplained: for each, the section where it matters and a short passage that explains it there.
 * Code adds each passage to its section; nothing else in the explanation changes.
 */
export function explainMissing(input: { layer: LayerRef; sections: { n: number; question: string; text: string }[]; missing: LayerNote[]; passages: Passage[] }): PromptPair {
  return {
    system: `A layer of a university course has an "Explained" tab: a teacher's explanation in sections, each answering one sub-question. Some named things in its readings are not yet explained in it. For each one, choose the section where it matters most and write one or two sentences (at most 45 words) that explain it there, as part of answering that section's question: what it is, an example from the reading, and why it matters, in plain words. The sentences are added at the end of that section, so they must read on from it naturally.

${CITING}

${STYLE}`,
    prompt: `${section("Layer", `${input.layer.title}\nBig question: ${input.layer.bigQuestion}`)}

${section("Sections", input.sections.map((s) => `### Section ${s.n}: ${s.question}\n${s.text}`).join("\n\n"))}

${section("Not yet explained (your notes from reading the course)", input.missing.map(noteLine).join("\n"))}

${section("Passages", formatPassages(input.passages))}

For each name not yet explained, give its section number and the sentences to add.`,
  };
}
