import type { PromptPair } from "./shared";

/** One file of the folder as the AI sees it: measured by code from the whole file, plus its headings and opening words. */
export interface OrganizeFile {
  /** "F1", "F2"…: how the answer refers to the file. */
  id: string;
  path: string;
  /** "PDF", "Word", "PowerPoint", "Text", "Markdown". */
  format: string;
  /** Who the file's own properties say wrote it; null when they don't say (text files never do). */
  author: string | null;
  pages: number;
  /** "pages", "slides", or "virtual pages of about 400 words" (Word and text files have no real pages). */
  pageWord: string;
  words: number;
  wordsPerPage: number;
  headings: string[];
  opening: string;
  /** Other paths where the very same file (the same bytes) sits in the folder. */
  copies?: string[];
  /** The file's pages in its printed page numbers (a chapter printed as pp. 7-45), when code found them; null when it has none. */
  printed?: { from: number; to: number } | null;
}

/** A file the course already holds, when new files are labelled later ("What's new"). */
export interface KnownFile {
  path: string;
  type: string;
  week: number | null;
}

/** A week the course already has, when new files are labelled later. */
export interface KnownWeek {
  week: number;
  date: string | null;
  title: string;
  kind: string;
}

const facts = (f: OrganizeFile) =>
  `${f.format} · ${f.pages} ${f.pageWord}${f.printed ? ` (printed page numbers pp. ${f.printed.from}-${f.printed.to})` : ""} · ${f.words.toLocaleString("en-US")} words in the whole file · ${f.wordsPerPage.toLocaleString("en-US")} words per ${f.pageWord === "slides" ? "slide" : "page"} · author in its properties: ${f.author ?? "not given"}`;

/**
 * The quick first look: which file (or files) is the syllabus, from the folder tree and each file's opening. Its full text is then given
 * to `organizeCourse`. Usually one file; none when the folder has no syllabus.
 */
export function findSyllabus(input: { course: string; tree: string; files: OrganizeFile[] }): PromptPair {
  return {
    system: `You look at a university student's course folder for the first time and find the SYLLABUS: the document from the instructor that describes the course and its schedule (it may be called a syllabus, course outline, course information, course schedule, or have no telling name at all). Answer with the file ids of the syllabus, usually one. Include a second file only if it is a separate part of the same syllabus, such as a reading list or a schedule. Answer with an empty list if no file is a syllabus. Judge by what the text says, not only by the name.`,
    prompt: `Course: ${input.course}

Folder tree:
${input.tree}

Files (id | path | facts | opening words):
${input.files.map((f) => `${f.id} | ${f.path} | ${facts(f)} | ${f.opening.split(/\s+/).slice(0, 120).join(" ")}`).join("\n")}

Which files are the syllabus?`,
  };
}

/** A break between numbered weeks (a reading week, a holiday) that the syllabus does not number itself. */
export interface CourseBreak {
  afterWeek: number;
  date: string | null;
  title: string;
}

/** Why Margin needs each file labelled right, said once and shared by the sorting and the final check. */
const PURPOSE = `Margin is a study app. It groups a course by week, splits each week into short layers, and the student learns one layer at a time from the week's readings and lecture material. So every file has to land in the right week with the right type: a reading in the wrong week is studied out of order, lecture material mistaken for the student's notes drops out of the week's layers, and a wrong week count leaves an empty or doubled week. The student sees the result and can change anything, but they will trust it, so get it right and say plainly where you are not sure.`;

const WEEKS = `How to number the weeks, and why:
- Follow the course's own numbering: classes, lectures or weeks, exactly as the syllabus numbers them ("Class 8", "Lecture Eight", "Week 8"). The student, the syllabus and the folders all use that number for the same session, so if Margin counted differently everything after a break would be off by one. If the syllabus numbers both weeks and lectures, use its weeks.
- A break the syllabus does not number (a reading week, a holiday, "no class") sits between two numbered weeks. List it under "breaks" with the week it follows, titled as the syllabus names it (short); if the syllabus only skips a date, title it "No class". It never gets a number of its own and never shifts the numbers after it. A session the syllabus does number (for example "Week Seven: in-class midterm", or "Week 7: reading week" in a syllabus that numbers every calendar week) is a numbered week of kind "exam" or "no-class".
- When the folder or file numbering ("Week 12", "Wk 12", "L07") agrees with the syllabus, use it. If they genuinely disagree, do not silently pick one: choose the more likely, mark every affected file "check", and say in its reason what the syllabus says and what the folder or name says.
- Only when nothing is numbered at all (a syllabus with dates only, folders without numbers) count by calendar week from the first class, still leaving breaks out of the count.
- With no syllabus, the folder and file names are the course's numbering.`;

const TYPES = `What each type means, and why it matters:
- "reading": a required reading (a book chapter, an article, a court case, a primary source). Goes into the week's layers.
- "lecture": lecture material, anything the professor posts for a lecture whatever its format: slides, slides with notes underneath (a "Notes View" or "Notes Page" export), or a document of lecture notes and key points. Goes into the week's layers and the layer's Lecture tab.
- "my-notes": notes the student wrote themselves. They are copied into the student's own Lecture notes page for that week and never become layers.
- "syllabus": the course syllabus or outline. Kept as the course overview, never a layer.
- "exam": exam instructions, review guides, past or practice exams, assignment instructions. Kept for the exam room.
- "optional": a reading the syllabus or the folder marks as optional, supplementary, recommended or further reading. Shown beside the layers, not in them.

Telling the student's notes from the professor's lecture material matters, and it is not always easy: students often join Margin mid-semester with their own notes already typed up as Word files or PDFs, next to the professor's handouts in the same folders. Calling the professor's material "my-notes" takes it out of the student's study; calling the student's notes "lecture" puts their jottings into the layers as if the professor had written them. Weigh the real clues together:
- The author in the file's properties, compared with the other files. The professor's slides and handouts usually share one author (or name the professor); a file whose author differs from all of them, especially one that matches other notes-like files, is likely the student's. A missing author, or a generic one ("Microsoft Office User", "User", "(anonymous)", a publisher or a book's authors), proves nothing either way.
- The writing style. Personal notes use abbreviations, arrows (->, =>), fragments and questions to oneself ("why does this matter??", "ask in tutorial"), reminders, "I" and "me", and follow what was said in class. Professor material is polished and consistent and follows the lectures or slides in order. Fragments alone are not enough: a professor's lecture outline is often bullet points too, so look for the personal voice. A document titled like a handout for one lecture (for example "POL326 Lecture #3" with that lecture's topic) that covers the lecture point by point is the professor's.
- Whether it mirrors a lecture: a "Notes View" or "Notes Page" export, or a document whose headings follow one lecture's slides, is the professor's lecture material.
- Folder and file names: a folder like "My notes", "Notes" or the student's own name, or a file named "my notes wk3", points to the student; a lecture folder with the professor's files points to the professor.
When the clues disagree or are thin, choose the more likely type, mark "check", and say in the reason which clues point which way (for example "Its author differs from the slides and it is written in fragments with arrows, but it sits in the Lecture 4 folder, so check this").`;

/** One file, different pages in different weeks: said once and shared by the sorting, the final check and the check of older courses. */
export const PAGE_RANGES = `One file, different pages in different weeks: a syllabus sometimes assigns different page ranges of the same file to different weeks (for example "Clogg, pp. 7-30" in Week 2 and "Clogg, pp. 31-45" in Week 3), and the student often saves that file in each of those week folders. Margin keeps one copy and splits its pages between the weeks, so each week studies only its own pages. For such a file give "pages": one entry per week with the page range the syllabus assigns (week, from, to), in the printed page numbers shown in the file's facts (or the file's own page numbers when none are shown). Only the syllabus decides this: give "pages" only when it assigns different pages of the same file to two or more weeks, and leave it empty for every other file. The file's own week stays the week of the folder it sits in (its first copy); pages no week is assigned stay there.`;

/**
 * Read the course like a person would: the syllabus first, then the folder and file names, then each file's own words. Returns the
 * course's weeks (and the breaks between them) and, for every file, its week, its type, how sure it is and why. Code checks the answer
 * (`lib/import/organize.ts`), then `checkSorting` looks the whole result over. With `known`, only the listed new files are labelled,
 * into the course's existing weeks.
 */
export function organizeCourse(input: {
  course: string;
  syllabus: { path: string; text: string }[];
  tree: string;
  files: OrganizeFile[];
  known?: { weeks: KnownWeek[]; files: KnownFile[] };
  /** Why the last answer was rejected, so it can be fixed. */
  feedback?: string;
}): PromptPair {
  const update = !!input.known;
  return {
    system: `You organise a university student's course folder the way a careful student would on the first day: read the syllabus, look at how the folders and files are named, and open each file to see what it is. ${update ? "The course is already organised and new files were added. Label only the new files, into the course's existing weeks." : "Work out the course's weeks and label every file."}

${PURPOSE}

Where the evidence comes from:
- The syllabus is the instructor's plan: what each week covers and which readings go with it.
- The folder and file names are the student's own organisation. The student sorted these files on purpose, so a file in a "Week 5" folder or named "Wk 05" belongs to week 5 unless that is clearly wrong (for example the syllabus and the file's own content both say another week). Respect their structure; do not reorganise it to fit a pattern of your own.
- The file's content (its headings, opening words and size) says what kind of file it is. A long text with many words per page is a reading even if nothing in its name says so; slides have few words per page. The word counts given are measured over the whole file.

${WEEKS}

For each week give its title in the syllabus's own words (shortened to the topic, without readings or dates), its date as the syllabus writes it (null if none), its kind ("class", "no-class", or "exam" for a midterm or final held in class time), and what the syllabus says about it (its topic line and reading list, as written, up to a few sentences) in "syllabus"; leave "syllabus" empty when there is no syllabus.

Matching readings to the syllabus: match by author, title, book and page range, not exact wording. "Gallant, Modern Greece, pp. 1-24" matches a 25-page PDF named "Wk 02 - Gallant - The Greek World and Its Ottoman Context". A file name may carry only the author, only the chapter title, or neither.

${TYPES}

The answer:
- ${update ? "Every new file listed" : "Every file listed"} gets exactly one entry: one type and one week. Course material (reading, lecture) always has a week, because layers are made week by week. The syllabus has week null. Exam material, optional readings and the student's notes have a week if one is clear, otherwise null.
- ${update ? "Use only the course's existing weeks." : "Every file's week must be one of the weeks you list."}
- "sure" only when the syllabus, a name or the content makes it clear. Otherwise "check": the student is shown those files to look at, so a silent guess is worse than a check.
- The reason is one short plain sentence saying what decided it, for example "Listed in the syllabus under Class 2 as Gallant, Modern Greece, pp. 1-24", "In the Week 3 folder; 24 slides with few words each", or "The folder says Week 5 but the syllabus lists this reading under Week 6, so check this".
- List syllabus readings you could not find among the files (with their week), and the ids of files the syllabus does not mention (leave out the syllabus itself and the student's notes).
- Use only what the folder and the files show. Never invent a week, a date, a title or a reading.

${PAGE_RANGES}`,
    prompt: `Course: ${input.course}

${input.syllabus.length ? input.syllabus.map((s) => `== The syllabus (${s.path}), full text:\n${s.text}`).join("\n\n") : "== There is no syllabus in this folder."}
${input.known ? `\n== The course's weeks (week | date | kind | title):\n${input.known.weeks.map((w) => `Week ${w.week} | ${w.date ?? "no date"} | ${w.kind} | ${w.title || "(no title)"}`).join("\n") || "(none yet)"}\n\n== Files the course already holds (path | type | week):\n${input.known.files.map((f) => `${f.path} | ${f.type} | ${f.week ?? "no week"}`).join("\n")}\n` : ""}
== Folder tree${update ? " (new files marked NEW)" : ""}:
${input.tree}

== ${update ? "New files to label" : "Files"} (measured by Margin over the whole file):
${input.files.map((f) => `### ${f.id} | ${f.path}\n${facts(f)}${f.copies?.length ? `\nThe same file is also in the folder as: ${f.copies.join("; ")}` : ""}\nHeadings: ${f.headings.length ? f.headings.join(" · ") : "(none)"}\nOpening words:\n${f.opening}`).join("\n\n")}

${input.feedback ? `Your last answer was rejected: ${input.feedback}\nFix these problems.\n\n` : ""}${update ? "Label the new files." : "Work out the weeks and label every file."}`,
  };
}

/** One file of the sorted result, as the final check sees it. */
export interface SortedFile extends OrganizeFile {
  week: number | null;
  type: string;
  confidence: "sure" | "check";
  reason: string;
  pageRanges: { week: number; from: number; to: number }[];
}

const pagesLine = (pages: { week: number; from: number; to: number }[]) => (pages.length ? pages.map((p) => `week ${p.week}: pp. ${p.from}-${p.to}`).join("; ") : "-");

/** What code counted about one week of the sorted result. */
export interface WeekTally {
  week: number;
  files: number;
  words: number;
  types: string;
  folders: string;
}

/**
 * The final look over a sorted course, the way a sharp teaching assistant would: does the whole result make sense? Sees the syllabus, the
 * folder tree, the weeks and every file's label with what code counted per week. Answers only with changes; code checks them again.
 */
export function checkSorting(input: {
  course: string;
  syllabus: { path: string; text: string }[];
  tree: string;
  weeks: { week: number; date: string | null; kind: string; title: string }[];
  breaks: CourseBreak[];
  tally: WeekTally[];
  files: SortedFile[];
  missingReadings: { week: number | null; reading: string }[];
  notInSyllabus: string[];
  /** Why the last answer's changes couldn't be used, so they can be fixed. */
  feedback?: string;
}): PromptPair {
  return {
    system: `You are a sharp teaching assistant. A student's course folder has just been sorted into weeks and types by a first pass that read the syllabus and every file. Before the student starts studying from it, you look over the whole result at once and ask the question the first pass, working file by file, can miss: does this make sense as a course?

${PURPOSE}

Check, using common sense:
1. The number of weeks matches the syllabus's own numbering and the folders. If the folders run Week 1 to Week 12 and the syllabus numbers twelve classes, the course has twelve weeks, not thirteen. Breaks are listed separately and are never numbered weeks.
2. No week is empty or overloaded without a reason. An exam week or a numbered no-class week may be empty; a class week with nothing in it while a folder of files sits in the week next to it is a sign of a numbering slip.
3. No file's name or folder contradicts the week or type it was given. A file in the "Week 12" folder or named "Wk 12" placed in week 13, a "Notes View" export of the professor's slides labelled as the student's notes, or a 30-page dense text labelled as lecture material all need a fix or an explanation.
4. Nothing in the syllabus is unaccounted for: every week in its schedule appears, and every required reading is matched to a file or listed as missing.

${WEEKS}

${TYPES}

${PAGE_RANGES}

The student organised their folders on purpose. Respect their structure: move a file away from what its folder or name says only when the syllabus and the file itself clearly say otherwise.

How to answer: only with what should change.
- "weeks": the full corrected list of weeks if the weeks are wrong (each with week, date, title, kind, syllabus), otherwise null. "breaks": the full corrected list of breaks if they are wrong, otherwise null. "missingReadings": the full corrected list if it is wrong (for example after renumbering), otherwise null.
- "files": only files whose week or type should change, or that should be marked "check", or whose "pages" are wrong. Give each one's full new label: week, type, confidence, a reason and its pages (empty keeps the pages it has). When the answer is clear, fix it ("sure") and say in the reason what was fixed and why, in one plain sentence. When it is not clear, keep the more likely label, mark it "check", and say plainly what the two possibilities are. If you renumber the weeks, include every file whose week number changes.
- "notes": at most a few plain sentences about the course as a whole that the student should know and that no single file shows (for example "The syllabus lists two Week 9 sessions; both are in week 9."). Empty when everything makes sense.
- If everything makes sense, answer weeks null, breaks null, missingReadings null, files [] and notes []. Do not change things for the sake of it, and never invent a week, a date, a title or a reading.`,
    prompt: `Course: ${input.course}

${input.syllabus.length ? input.syllabus.map((s) => `== The syllabus (${s.path}), full text:\n${s.text}`).join("\n\n") : "== There is no syllabus in this folder."}

== Folder tree:
${input.tree}

== The sorted weeks (week | date | kind | title):
${input.weeks.map((w) => `Week ${w.week} | ${w.date ?? "no date"} | ${w.kind} | ${w.title || "(no title)"}`).join("\n") || "(none)"}

== Breaks between weeks:
${input.breaks.map((b) => `After week ${b.afterWeek} | ${b.date ?? "no date"} | ${b.title}`).join("\n") || "(none)"}

== Counted by Margin, per week (week | files | words | types | folders the files come from):
${input.tally.map((t) => `Week ${t.week} | ${t.files} | ${t.words.toLocaleString("en-US")} | ${t.types || "-"} | ${t.folders || "-"}`).join("\n") || "(none)"}

== Every file as sorted (id | path | facts | week | type | confidence | reason | pages by week):
${input.files.map((f) => `${f.id} | ${f.path} | ${facts(f)}${f.copies?.length ? ` · also in the folder as: ${f.copies.join("; ")}` : ""} | ${f.week === null ? "no week" : `week ${f.week}`} | ${f.type} | ${f.confidence} | ${f.reason} | ${pagesLine(f.pageRanges)}`).join("\n")}

== Syllabus readings not found among the files:
${input.missingReadings.map((r) => `${r.week ? `Week ${r.week}` : "No week"} | ${r.reading}`).join("\n") || "(none)"}

== Files the syllabus does not mention: ${input.notInSyllabus.join(", ") || "(none)"}

${input.feedback ? `Your last answer's changes could not be used: ${input.feedback}\nFix these problems.\n\n` : ""}Does the whole result make sense? Answer only with what should change.`,
  };
}

/**
 * Courses imported before Margin split one file's pages between weeks: Claude reads the syllabus and the files saved in more than one
 * folder, and gives each such file's page ranges by week, the same rule as at import. Checked by code (`lib/projects/page-ranges.ts`).
 */
export function pageRangesOfCopies(input: {
  course: string;
  syllabus: { path: string; text: string }[];
  weeks: KnownWeek[];
  files: (OrganizeFile & { week: number | null })[];
  feedback?: string;
}): PromptPair {
  return {
    system: `You help organise a university student's course folder that is already sorted into weeks. Some files are saved in more than one week folder (the very same file). Your one job is to read the syllabus and say, for each of those files, whether the syllabus assigns different pages of it to different weeks.

${PURPOSE}

${PAGE_RANGES}

The answer: one entry per file listed, with its id and its "pages" (empty when the syllabus does not split the file between weeks). Use only the course's weeks listed. Never invent a page range the syllabus does not give.`,
    prompt: `Course: ${input.course}

${input.syllabus.map((s) => `== The syllabus (${s.path}), full text:\n${s.text}`).join("\n\n")}

== The course's weeks (week | date | kind | title):
${input.weeks.map((w) => `Week ${w.week} | ${w.date ?? "no date"} | ${w.kind} | ${w.title || "(no title)"}`).join("\n") || "(none)"}

== Files saved in more than one folder:
${input.files.map((f) => `### ${f.id} | ${f.path}\n${facts(f)}\nIn the course as week ${f.week ?? "none"}; also in the folder as: ${f.copies?.join("; ") || "-"}\nHeadings: ${f.headings.length ? f.headings.join(" · ") : "(none)"}`).join("\n\n")}

${input.feedback ? `Your last answer was rejected: ${input.feedback}\nFix these problems.\n\n` : ""}Give each file's pages by week.`,
  };
}
