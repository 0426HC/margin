import type { LectureFacts } from "@/lib/lecture/types";
import { FROM_NOTES } from "@/lib/lecture/text";
import { BEYOND, formatPassages, section, type Passage, type PromptPair } from "./shared";

const cite = (s: { file: string; page: number }) => `[${s.file}, p. ${s.page}]`;

/** The numbers Margin counted from one lecture file, as plain lines the model can use but must not recount. */
export function formatFacts(f: LectureFacts): string {
  const lines = [`Slides or pages: ${f.slides}.`];
  lines.push(f.terms.length ? `Ideas that come back across slides, by number of slides: ${f.terms.map((t) => `${t.term} (${t.slides.length} slides: ${t.slides.map((s) => s.page).join(", ")})`).join("; ")}.` : "No idea comes back across more than one slide.");
  lines.push(f.longest.length ? `Slides with the most on them: ${f.longest.map((s) => `${cite(s)} "${s.title}" (${s.words} words)`).join("; ")}.` : "");
  lines.push(f.repeated.length ? `Phrases repeated on more than one slide: ${f.repeated.map((r) => `"${r.phrase}" (slides ${r.slides.map((s) => s.page).join(", ")})`).join("; ")}.` : "No phrase is repeated across slides.");
  lines.push(f.flagged.length ? `Lines the material marks as important:\n${f.flagged.map((x) => `- ${cite(x)} ${x.text}`).join("\n")}` : "Nothing in the material is marked as important.");
  lines.push(f.examples.length ? `Lines that introduce an example:\n${f.examples.map((x) => `- ${cite(x)} ${x.text}`).join("\n")}` : "No slide introduces an example in so many words.");
  return lines.filter(Boolean).join("\n");
}

export interface LectureWeek {
  course: string;
  week: number;
  /** The week's title in the syllabus's words, or "". */
  title: string;
  /** What the syllabus says about the week, or "". */
  syllabus: string;
}

const weekLine = (w: LectureWeek) => `${w.course}, Week ${w.week}${w.title ? `: ${w.title}` : ""}${w.syllabus ? `\nThe syllabus says: ${w.syllabus}` : ""}`;

const FORMAT = `Write plain text in this format, nothing else (no preamble, no closing line):
- "### " starts a topic heading, in plain words.
- "- " starts a bullet.
- Any other line is a paragraph. Leave a blank line between blocks.
- Nothing else: no bold or italics, no nested bullets, no tables. The page shows only these blocks, so other markup would show as stray symbols.
Cite as [file, p. N], using exactly a file name and a page that appear in the passages you were given; the page shows in the margin beside the text, so never write "p. N" any other way.`;

/**
 * Section 1 of the week's Lecture tab: what the lecture covered according to the student's own notes. Students write a few lines in class,
 * so each point is expanded a little from the week's material and pointed back to where the files cover it; the full lecture is section 2.
 */
export function lectureFromNotes(input: { week: LectureWeek; notes: string[]; passages: Passage[] }): PromptPair {
  return {
    system: `You write the "From your lecture notes" section of a study app's Lecture tab for one week of a course. The student took these notes in class, often only a few words per point. They want to read back, in a clear, organised form, what the lecture covered according to their notes, and to see where their readings and the lecture material cover each point, so they can check and deepen it.

What to write (200-400 words, never more; fewer when the notes are very short: this is a quick read before the full lecture section, so keep each point to the student's point plus one or two sentences):
- Go through the points the student actually wrote, grouped by topic in a sensible order (keep the student's order when it already makes sense). Put each point in plain words, as a full sentence.
- For each point, add a sentence or two of context from the passages you were given, so a short note becomes understandable, and cite where the files cover it as [file, p. N]. This is the point of the section: the student's few words, connected to their files.
- Expand only what the student wrote. Do not add topics the notes do not mention, even if the passages cover them: the whole lecture is covered in a separate section, so adding it here would repeat it and bury the student's own notes.
- A point that appears only in the student's notes, with nothing in the passages about it, keeps the student's meaning in plain words and ends with "${FROM_NOTES}". Never give such a point a citation: a page that does not say it would send the student to look for something that is not there.
- Every paragraph and bullet ends with either at least one [file, p. N] citation or "${FROM_NOTES}".
- Never invent facts, names, dates, numbers or pages. If a note is unclear (an abbreviation, a half sentence), say what it most plainly says and mark it "${FROM_NOTES}" rather than guess.
- Say "your notes", "the readings", "the lecture material". Never "the professor said": you only have what is written.
- Plain, short sentences. Explain any name or term the first time it appears, briefly, from the passages.
${BEYOND}

${FORMAT}`,
    prompt: `${section("Week", weekLine(input.week))}\n\n${section("The student's lecture notes, as written", input.notes.join("\n"))}\n\n${section("Passages from this week's readings and lecture material about these notes", input.passages.length ? formatPassages(input.passages) : "(none found: every point comes only from the notes)")}\n\nWrite the section.`,
  };
}

/**
 * Section 2 of the week's Lecture tab: what the lecture material the professor posted spent its time on, what it stressed, the examples it
 * used and where it differs from the readings. Counting is done by code; only what the material itself marks counts as stressed.
 */
export function lectureFromMaterial(input: { week: LectureWeek; files: { file: string; facts: LectureFacts; passages: Passage[] }[]; reading: Passage[] }): PromptPair {
  return {
    system: `You write the "From the lecture material" section of a study app's Lecture tab for one week of a course. The student has the week's readings and the material the professor posted for the lecture (slides, slides with notes underneath, or a document of lecture notes). They want to see what the lecture did with the week: where it put its weight, what it stressed, the examples it used, and where it differs from the readings, so they know what the lecture adds.

The lecture material is given file by file, with its slide or page number as the page. Below, "slide" means a slide or a page of the lecture material. The numbers under "Counted by Margin" are exact; use them and never count again.

If the material is for two or more different lectures (for example "Lecture 5" and "Lecture 6", or two dates), give each lecture its own part: a line "## " with the lecture's name as the material gives it, then its four topics. Two files for the same lecture (the slides and the slides with notes) are one lecture. With one lecture, write no "## " line.

Keep it to about 500-800 words for one lecture (a little more for two): the student reads this beside the readings, so choose what matters most rather than listing everything.

For each lecture, these four topics, each a "### " heading followed by a short paragraph or bullets, in this order:
### What it spent its time on
The ideas that got the most slides, using the counts, and the slides with the most on them.
### What it stressed
Only what the material itself marks as important (said to be important, key, on the exam, to remember) or keeps repeating, using the counts. If nothing is marked, say so in one line. Never guess what a professor "probably" wants known: a guess presented as emphasis would send the student to study the wrong thing.
### The examples it used
Each example in a bullet, with its slide.
### Where it differs from the readings
What the lecture adds, leaves out or puts differently compared with the readings, citing both the slide and the reading page: the few differences that matter most for understanding the week (at most five), not every small one. If there are no readings, or they agree, say so in one line.

Plain English, short sentences. Say "the lecture", "the slides" or "the lecture notes", never "the professor said": the written material is all you have. Explain any name or term the first time it appears.
Every paragraph and bullet carries at least one [file, p. N] citation, except a one-line statement that a topic has nothing to report. Never invent anything.
${BEYOND}

${FORMAT}`,
    prompt: `${section("Week", weekLine(input.week))}\n\n${input.files.map((f) => `${section(`Lecture file: ${f.file}`, `Counted by Margin:\n${formatFacts(f.facts)}\n\n${formatPassages(f.passages)}`)}`).join("\n\n")}\n\n${section("Reading passages", input.reading.length ? formatPassages(input.reading) : "(no readings this week)")}\n\nWrite the section.`,
  };
}
