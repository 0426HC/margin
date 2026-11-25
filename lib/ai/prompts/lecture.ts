import type { LectureFacts } from "@/lib/lecture/types";
import { BEYOND, GROUNDING, formatPassages, section, type Passage, type PromptPair } from "./shared";
import type { LayerRef } from "./layer-content";

const cite = (s: { file: string; page: number }) => `[${s.file}, p. ${s.page}]`;

/** The numbers Margin counted, as plain lines the model can use but must not recount. */
export function formatFacts(f: LectureFacts): string {
  const lines = [`Slides in this layer: ${f.slides} (${f.files.map((x) => `${x.slides} from ${x.name}`).join("; ")}).`];
  lines.push(f.terms.length ? `Ideas that come back across slides, by number of slides: ${f.terms.map((t) => `${t.term} (${t.slides.length} slides: ${t.slides.map((s) => s.page).join(", ")})`).join("; ")}.` : "No idea comes back across more than one slide.");
  lines.push(f.longest.length ? `Slides with the most on them: ${f.longest.map((s) => `${cite(s)} "${s.title}" (${s.words} words)`).join("; ")}.` : "");
  lines.push(f.repeated.length ? `Phrases repeated on more than one slide: ${f.repeated.map((r) => `"${r.phrase}" (slides ${r.slides.map((s) => s.page).join(", ")})`).join("; ")}.` : "No phrase is repeated across slides.");
  lines.push(f.flagged.length ? `Lines the slides mark as important:\n${f.flagged.map((x) => `- ${cite(x)} ${x.text}`).join("\n")}` : "Nothing on the slides is marked as important.");
  lines.push(f.examples.length ? `Lines that introduce an example:\n${f.examples.map((x) => `- ${cite(x)} ${x.text}`).join("\n")}` : "No slide introduces an example in so many words.");
  return lines.filter(Boolean).join("\n");
}

/** The Lecture tab: what the lecture did with this layer. Counting is done by code; this prompt only writes it up. */
export function writeLecture(input: { layer: LayerRef; facts: LectureFacts; slides: Passage[]; reading: Passage[] }): PromptPair {
  return {
    system: `You write the "Lecture" tab for one layer of a course. The student has the readings and the lecture material (the professor's slides, slides with notes underneath, or a document of lecture notes), and wants to see what the lecture did with this topic: where it put its weight, what it kept coming back to, and how it differs from the reading.
${GROUNDING}
${BEYOND}
The lecture material is given with its slide or page number as the page: cite it as [file, p. N] with its own file name and number. Below, "slide" means a slide or a page of the lecture material. The numbers under "Counted by Margin" are exact; use them and never count again.

Write these sections, each as a heading followed by bullets or a short paragraph, in this order:
1. Where the lecture spent its time: the ideas that got the most slides, using the counts, and the slides with the most on them.
2. What it repeated: the repeated ideas and phrases, and where.
3. What it flagged as important: only what the slides themselves mark as important. If nothing is marked, say so in one line. Do not guess what a professor "probably" wants known.
4. The examples it used: each example in a line, with the slide.
5. Where it differs from the reading: what the lecture adds, leaves out or puts differently compared with the reading passages, citing both the slide and the reading page. If the layer has no reading passages, or they agree, say so in one line.
Plain English, short sentences. Say "the lecture", "the slides" or "the lecture notes", never "the professor said", because the written material is what you have.
Every paragraph and every bullet carries at least one [file, p. N] citation. When a section has nothing to report, write one block of type "none" with a plain one-line statement; that is the only block that goes without a citation.`,
    prompt: `${section("Layer", `${input.layer.title}\nBig question: ${input.layer.bigQuestion}`)}\n\n${section("Counted by Margin", formatFacts(input.facts))}\n\n${section("Lecture material", formatPassages(input.slides))}\n\n${section("Reading passages", input.reading.length ? formatPassages(input.reading) : "(none in this layer)")}\n\nWrite the Lecture tab.`,
  };
}

export interface NoteLine {
  n: number;
  week: number;
  text: string;
}

/** Which of the student's own class-note lines are about this layer, and where they seem to disagree with the slides. The lines are copied by code. */
export function filterNotes(input: { layer: LayerRef; slides: Passage[]; lines: NoteLine[] }): PromptPair {
  return {
    system: `You choose which of a student's own class notes belong to one layer of a course, and flag where those notes and the lecture material seem to say different things.
The notes are the STUDENT'S words, taken in class or at home. They are not the professor's words and not the lecture material.
Rules:
- relevant: the numbers of the note lines that are about this layer's topic. Leave out lines about other topics, and lines that are only headings or reminders. Answer with numbers only; never rewrite or quote a note.
- checks: at most a few, only where a note line clearly says something different from a slide. Each is one gentle sentence in the form "Your note says X, and slide N says Y. Worth a second look." Name the slide as [file, p. N] using only slides given. Never say the student is wrong, and never invent what a slide says.
- If nothing disagrees, checks is empty.`,
    prompt: `${section("Layer", `${input.layer.title}\nBig question: ${input.layer.bigQuestion}`)}\n\n${section("Lecture material", input.slides.length ? formatPassages(input.slides) : "(no lecture material)")}\n\n${section("The student's class notes (number | week | line)", input.lines.map((l) => `${l.n} | Week ${l.week} | ${l.text}`).join("\n"))}\n\nWhich note lines are about this layer, and where do they differ from the slides?`,
  };
}
