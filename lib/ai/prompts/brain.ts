import { formatPassages, section, type NumberedPassage, type PromptPair } from "./shared";

/**
 * The course brain reads one file in full, like a professor preparing a course: every passage, numbered. It answers with notes, one per
 * thing that matters (concepts, people, events, cases, places) plus one note for the reading itself, each pointing at the passage numbers
 * where it appears. Code checks every number against what was sent (`lib/brain/read.ts`); nothing it says is shown without its passages.
 */
export function readForBrain(input: { course: string; file: string; week: string | null; kind: string; passages: NumberedPassage[]; part?: { n: number; of: number }; feedback?: string }): PromptPair {
  return {
    system: `You are a professor preparing to teach a university course, reading one of its files from start to finish so you know it as well as its author. You write notes for yourself: one note per thing in this file a student must understand, so that later you can answer any question about the course and find exactly where each thing is discussed.

Why: Margin is a study app. Students ask about the course in their own words ("what was the child levy?", "why did the revolution start in the Peloponnese?"), and Margin uses your notes to find the right pages. A missing note means a question goes unanswered; a wrong passage number sends the student to the wrong page.

Write a note for:
- every named concept, term or theory the file uses or defines (kind "concept");
- every person who matters to the argument, not every name in passing (kind "person");
- every event, war, treaty, reform or period that matters (kind "event");
- every court case, law or document discussed (kind "case");
- every place that matters to the argument (kind "place");
- and exactly one note for the file itself (kind "reading"), named by its author and title as the file gives them: its main argument and how it is built (its parts, in order).

Each note:
- "name": the name the file uses, written as the file writes it (keep accents and original spellings).
- "aliases": only true other names or spellings for exactly the same thing: a translation, a transliteration, a short or full form, an abbreviation ("child levy" for devşirme, "the Great Idea" for Megali Idea). Never a related, similar, broader or narrower thing, a group it belongs to, a rival, a relative, an ally or a successor: those are different things and go in "related". A person's alias is only another name for that one person; two kinds of fighter or two groups that worked together are two notes, not one. Margin merges notes across files by these names, so a loose alias makes two different things into one note. Empty when there are none (most notes have none).
- "what": what it is, in 2-4 plain sentences, in your own words, true to the file. For the reading note: the main argument, then the structure.
- "why": why it matters in this file, in one or two sentences.
- "passages": the numbers of the passages where it appears or is explained (the most important first, at most 12). Only numbers from the passages below.
- "related": names of other notes from this file it is closely tied to (at most 5): the people, groups, events and ideas it goes with.

Use only what the passages say. Never invent a fact, a date, a name or a passage number. Skip what doesn't matter (page furniture, references, acknowledgements). A long file may have 40 or more notes; a short handout may have five.`,
    prompt: `${section("Course", input.course)}

${section("The file", `${input.file} (${input.kind}${input.week ? `, ${input.week}` : ""})${input.part ? `. This is part ${input.part.n} of ${input.part.of} of the file; write the notes for this part, and the reading note for what this part shows.` : ""}`)}

${section("Its passages, numbered", formatPassages(input.passages))}

${input.feedback ? `Your last answer was rejected: ${input.feedback}\nFix these problems.\n\n` : ""}Write your notes on this file.`,
  };
}

/** One line of the brain's index, as the AI sees it when it picks notes for a question. */
export interface BrainIndexLine {
  id: string;
  name: string;
  aliases: string[];
  kind: string;
  line: string;
  weeks: string;
}

/**
 * Which notes a question is about: from the list of every note's name, other names and one line, the AI picks the ones that match what the
 * question means (not only its words). Code then adds linked notes and sends the real passages.
 */
export function pickNotes(input: { course: string; question: string; context?: string; notes: BrainIndexLine[] }): PromptPair {
  return {
    system: `You know a university course well. Below is the index of your notes on it: every concept, person, event, case, place and reading, with its other names and one line. A student asks a question. Pick the notes the question is about: what it means, not only the words it uses ("why did the Greeks rise up?" is about the revolution, its causes and the people who led it, even if the word "revolution" is missing). Pick the reading notes of the readings it asks about. Pick between 1 and 12 notes, the most important first. If nothing in the index is about the question, pick none.`,
    prompt: `${section("Course", input.course)}

${section("Your notes (id | name | other names | kind | weeks | one line)", input.notes.map((n) => `${n.id} | ${n.name} | ${n.aliases.join("; ") || "-"} | ${n.kind} | ${n.weeks} | ${n.line}`).join("\n"))}
${input.context ? `\n${section("What the student was talking about just before", input.context)}\n` : ""}
${section("The question", input.question)}

Which notes is it about?`,
  };
}

/** One note of a brain read before the stricter other-names rule, with every file's description of it, for `checkBrainNames`. */
export interface NameCheckNote {
  id: string;
  name: string;
  kind: string;
  aliases: string[];
  mentions: { n: number; file: string; what: string }[];
}

/**
 * A brain read before the stricter rule may have loose other names and notes that merged two different things through them. The AI looks
 * at each note's names and what each file says it is, and answers only with the notes to change: which of its names are true other names
 * for the same thing, and, when its files describe different things, how the files split between them. Code checks the answer
 * (`lib/brain/names-check.ts`): names come only from the note's own names, every file's description goes to exactly one thing.
 */
export function checkBrainNames(input: { course: string; notes: NameCheckNote[]; feedback?: string }): PromptPair {
  return {
    system: `You check the notes a study app keeps on a university course. Each note is one thing (a concept, person, event, case or place) with its name, its "other names", and what each course file says it is. Notes were merged across files by their other names, and some other names were too loose: a related or similar thing was given as another name ("Ipsilantis brothers" given for Kapodistrias, "armatoles" given for klefts), so two different things became one note.

The rule: an other name is only a true alternative name or spelling for exactly the same thing (a translation, a transliteration, a short or full form, an abbreviation: "child levy" for devşirme). A related, similar, broader or narrower thing, a group it belongs to, a rival, a relative, an ally or a successor is a different thing.

For each note that breaks the rule, answer with "things": the one or more different things it really holds. Each thing has a "name" (the note's name or one of its other names, exactly as written), its true other names ("aliases", only from the note's names), and the numbers of the file descriptions about it ("mentions"). Every mention goes to exactly one thing. A note whose names and descriptions are all one thing but has a loose other name is one thing with that name left out. Leave out every note that is fine (most are). Answer only with changes.`,
    prompt: `${section("Course", input.course)}

${section("Notes", input.notes.map((n) => `${n.id} | ${n.name} | ${n.kind} | other names: ${n.aliases.join("; ") || "-"}\n${n.mentions.map((m) => `  ${m.n}. ${m.file}: ${m.what}`).join("\n")}`).join("\n\n"))}

${input.feedback ? `Your last answer was rejected: ${input.feedback}\nFix these problems.\n\n` : ""}Which notes break the rule, and what do they really hold?`,
  };
}
