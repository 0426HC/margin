// @vitest-environment node
/**
 * Import, Round 2: weeks follow the course's own numbering (breaks sit between weeks), the final check looks the whole sorted result
 * over, and the student's own notes are told apart from the professor's lecture material. Claude is played by scripted answers; the
 * fake engine and a temporary data folder only.
 */
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AiRequest } from "@/lib/ai/engine";
import { EngineError } from "@/lib/ai/errors";
import { FakeEngine } from "@/lib/ai/fake-engine";
import type { CourseCheckIn, CourseMapAnswer } from "@/lib/ai/schemas";
import { openDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { parseFile } from "@/lib/import/parse";
import { courseWeekRows, importNotesFile, removeStrayNoteCopies } from "@/lib/projects/course-import";
import { getPlanExtras } from "@/lib/projects/plan-page";
import { relabelFile } from "@/lib/projects/relabel";
import { addFile, analyzeProject, createProject } from "@/lib/projects/service";
import { getWeekNotes, saveWeekNotes } from "@/lib/weeks/notes";
import { makeDocx, makePdf, makePptx } from "../fixtures/build";
import type { CourseFile } from "../fixtures/courses";
import { CLASS_TOPICS, notesAndHandouts, PROF, STUDENT, twelveClasses } from "../fixtures/varied-courses";
import { scriptedOrganizer, weeksOf } from "./helpers/organizer";

let db: Db;
beforeAll(() => {
  process.env.MARGIN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "margin-review-"));
});
beforeEach(() => {
  db = openDb(":memory:").db;
});

async function importWith(name: string, files: CourseFile[], answer: (req: AiRequest) => unknown) {
  const id = createProject(db, { name });
  for (const f of files) await addFile(db, id, { name: f.relPath.split("/").pop()!, relPath: f.relPath, bytes: f.bytes });
  const engine = new FakeEngine({ json: answer });
  const steps: string[] = [];
  await analyzeProject(db, engine, id, (step) => steps.push(step));
  const calls = (marker: string) => engine.calls.filter((c) => c.system.includes(marker));
  return { id, steps, mapCall: calls("You organise a university student's course folder"), checkCall: calls("You are a sharp teaching assistant") };
}
const files = (id: string) => db.select().from(s.files).where(eq(s.files.projectId, id)).all();
const fileAt = (id: string, end: string) => files(id).find((f) => f.relPath.endsWith(end))!;
const folderWeek = (p: string) => Number(/\/Week (\d+)\//.exec(p)?.[1] ?? NaN);

// ---------------------------------------------------------------- 12 numbered classes, a reading week, folders Week 1 to Week 12

const CLASS_WEEKS = weeksOf([
  ["Course introduction", "September 8"],
  ["Salt and the first ports", "September 15"],
  ["The guild charters", "September 22"],
  ["Lighthouses and law", "September 29"],
  ["The plague years", "October 6"],
  ["Shipwrights and their towns", "October 13"],
  ["In-class midterm test", "October 20", "exam"],
  ["The customs wars", "November 3"],
  ["Canals and the new river trade", "November 10"],
  ["Harbour towns in decline", "November 17"],
  ["Rebuilding the waterfront", "November 24"],
  ["The harbour town today", "December 1"],
]);
const READING_WEEK = { afterWeek: 7, date: "October 26-30", title: "Reading Week" };
const label = (shift: (w: number) => number) => (p: string) =>
  p.endsWith("Syllabus - Fall.pdf") ? { week: null, type: "syllabus" as const } : { week: shift(folderWeek(p)), type: p.includes("Notes View") ? ("lecture" as const) : ("reading" as const), reason: `In the Week ${folderWeek(p)} folder.` };

/** The slip this round fixes: counting calendar weeks, so the reading week becomes week 8 and every class after it moves on by one. */
const calendarWeeks: CourseMapAnswer["weeks"] = [
  ...CLASS_WEEKS.slice(0, 7),
  { week: 8, date: "October 26-30", title: "Fall Reading Week", kind: "no-class", syllabus: "Reading Week: October 26-30, no class" },
  ...CLASS_WEEKS.slice(7).map((w) => ({ ...w, week: w.week + 1 })),
];

describe("12 numbered classes, a reading week between classes 7 and 8, folders Week 1 to Week 12", () => {
  it("the course has 12 weeks in the course's own numbering; the reading week is a break, and every Wk 12 file is in week 12", async () => {
    const { id, mapCall, checkCall, steps } = await importWith("HAR312", await twelveClasses(), scriptedOrganizer({
      isSyllabus: (p) => p.endsWith("Syllabus - Fall.pdf"),
      weeks: CLASS_WEEKS,
      breaks: [READING_WEEK],
      label: label((w) => w),
    }));
    // what Claude is told: number weeks as the course does, and never count a break
    expect(mapCall[0].system).toContain("Follow the course's own numbering");
    expect(mapCall[0].system).toContain("It never gets a number of its own and never shifts the numbers after it");
    expect(mapCall[0].system).toContain("Only when nothing is numbered at all");
    expect(mapCall[0].system).toContain("The student sorted these files on purpose");

    expect(courseWeekRows(db, id).map((w) => w.week)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(courseWeekRows(db, id).find((w) => w.week === 7)).toMatchObject({ kind: "exam" });
    for (const f of files(id).filter((x) => x.relPath.includes("/Week "))) expect(f.week).toBe(folderWeek(f.relPath));
    expect(fileAt(id, `Wk 12 - Varo - ${CLASS_TOPICS[12][0]} and ${CLASS_TOPICS[12][1]}.pdf`)).toMatchObject({ week: 12, type: "reading" });
    expect(files(id).some((f) => (f.week ?? 0) > 12)).toBe(false);
    expect(getPlanExtras(db, id)).toMatchObject({ weekCount: 12, review: ["Reading Week (October 26-30) sits between week 7 and week 8. It is a break, not a week of its own."] });

    // the final check ran on the whole result, on Opus at low effort, and showed as a step
    expect(checkCall).toHaveLength(1);
    expect(checkCall[0]).toMatchObject({ model: "claude-opus-5-5", effort: "low", task: "check" });
    expect(steps).toContain("Looking over the whole result the way a teaching assistant would: weeks, folders and syllabus");
    expect(steps).toContain("The final check found nothing that doesn't make sense");
    expect(steps.at(-1)).toBe("Done");
  });

  it("the final check catches the calendar-week slip (13 weeks, Wk 12 files in week 13) and fixes it from the folders and the syllabus", async () => {
    const { id, checkCall, steps } = await importWith("HAR312", await twelveClasses(), scriptedOrganizer({
      isSyllabus: (p) => p.endsWith("Syllabus - Fall.pdf"),
      weeks: calendarWeeks,
      label: label((w) => (w >= 8 ? w + 1 : w)),
      check: (_idOf, req) => {
        const moved = [...req.prompt.matchAll(/^(F\d+) \| (HAR312\/Week (\d+)\/[^|]+?) \|/gm)].filter((m) => Number(m[3]) >= 8);
        return {
          weeks: CLASS_WEEKS,
          breaks: [READING_WEEK],
          missingReadings: null,
          files: moved.map((m) => ({ file: m[1], week: Number(m[3]), type: m[2].includes("Notes View") ? "lecture" : "reading", confidence: "sure", reason: `In the Week ${m[3]} folder, which is Class ${m[3]} in the syllabus; the reading week is not a numbered week.` })),
          notes: [`The syllabus numbers twelve classes and the folders run Week 1 to Week 12, so the course has 12 weeks; the reading week sits between classes 7 and 8.`],
        } satisfies CourseCheckIn;
      },
    }));
    // what the check was shown: the weeks as sorted, and per week the folders the files come from, so the slip is visible
    const prompt = checkCall[0].prompt;
    expect(prompt).toContain("Week 8 | October 26-30 | no-class | Fall Reading Week");
    expect(prompt).toMatch(/^Week 13 \| 2 \| [\d,]+ \| 1 lecture material, 1 reading \| 2 HAR312\/Week 12$/m);
    expect(prompt).toContain("Week 12/\n    WK 12 - today - Notes View.pdf\n    Wk 12 - Varo");
    expect(checkCall[0].system).toContain("If the folders run Week 1 to Week 12 and the syllabus numbers twelve classes, the course has twelve weeks, not thirteen");

    expect(courseWeekRows(db, id).map((w) => w.week)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const f of files(id).filter((x) => x.relPath.includes("/Week "))) expect(f.week).toBe(folderWeek(f.relPath));
    expect(fileAt(id, `Wk 12 - Varo - ${CLASS_TOPICS[12][0]} and ${CLASS_TOPICS[12][1]}.pdf`)).toMatchObject({ week: 12, needsCheck: false, reason: expect.stringContaining("Class 12 in the syllabus") });
    expect(steps).toContain("The final check the course has 12 weeks, not 13, fixed 8 files");
    const extras = getPlanExtras(db, id);
    expect(extras.weekCount).toBe(12);
    expect(extras.review[0]).toBe("Reading Week (October 26-30) sits between week 7 and week 8. It is a break, not a week of its own.");
    expect(extras.review[1]).toMatch(/^The syllabus numbers twelve classes/);
  });

  it("when the folder and the syllabus genuinely disagree, the check marks the file 'check this' with both sides, and moves nothing", async () => {
    const { id } = await importWith("HAR312", await twelveClasses(), scriptedOrganizer({
      isSyllabus: (p) => p.endsWith("Syllabus - Fall.pdf"),
      weeks: CLASS_WEEKS,
      breaks: [READING_WEEK],
      label: label((w) => w),
      check: (idOf) => ({
        weeks: null,
        breaks: null,
        missingReadings: null,
        files: [{ file: idOf("WK 10 - decline - Notes View.pdf"), week: 10, type: "lecture", confidence: "check", reason: "In the Week 10 folder, but its slides are about canals, which the syllabus puts in Class 9; check which week it belongs to." }],
        notes: [],
      }),
    }));
    expect(fileAt(id, "WK 10 - decline - Notes View.pdf")).toMatchObject({ week: 10, type: "lecture", needsCheck: true, reason: expect.stringContaining("Class 9") });
    expect(getPlanExtras(db, id).check).toBe(1);
  });

  it("changes from the check that don't fit are sent back once; if they still don't fit, the first sorting stands", async () => {
    const { id, steps, checkCall } = await importWith("HAR312", await twelveClasses(), scriptedOrganizer({
      isSyllabus: (p) => p.endsWith("Syllabus - Fall.pdf"),
      weeks: CLASS_WEEKS,
      breaks: [READING_WEEK],
      label: label((w) => w),
      check: (idOf) => ({ weeks: null, breaks: null, missingReadings: null, files: [{ file: idOf("Wk 02 - Varo - salt and port.pdf"), week: 20, type: "reading", confidence: "sure", reason: "Moved." }, { file: "F999", week: 2, type: "reading", confidence: "sure", reason: "Made up." }], notes: ["Should not be shown."] }),
    }));
    expect(fileAt(id, "Wk 02 - Varo - salt and port.pdf")).toMatchObject({ week: 2 });
    expect(steps).toContain("The final check's changes had problems, so Margin is asking once more");
    expect(steps).toContain("The final check's changes didn't fit the files, so the sorting stays as first read");
    expect(checkCall).toHaveLength(2); // sent back once, with its problems listed
    expect(checkCall[1].prompt).toContain("Your last answer's changes could not be used: These ids are not files of this course: F999.");
    expect(checkCall[1].prompt).toMatch(/F\d+ is put in week 20, which is not one of the weeks you listed\./);
    expect(getPlanExtras(db, id).review).not.toContain("Should not be shown.");
  });

  it("a second answer from the check that fits is used", async () => {
    let n = 0;
    const { id, checkCall } = await importWith("HAR312", await twelveClasses(), scriptedOrganizer({
      isSyllabus: (p) => p.endsWith("Syllabus - Fall.pdf"),
      weeks: CLASS_WEEKS,
      breaks: [READING_WEEK],
      label: label((w) => w),
      check: (idOf) => ({ weeks: null, breaks: null, missingReadings: null, files: [{ file: idOf("Wk 03 - Varo - guild and charter.pdf"), week: n++ === 0 ? 20 : 3, type: "reading", confidence: "check", reason: "In the Week 3 folder, but the syllabus names no reading for Class 3; check this." }], notes: [] }),
    }));
    expect(checkCall).toHaveLength(2);
    expect(fileAt(id, "Wk 03 - Varo - guild and charter.pdf")).toMatchObject({ week: 3, needsCheck: true });
  });

  it("if the check can't run, the first sorting stands and the student is told", async () => {
    const good = scriptedOrganizer({ isSyllabus: (p) => p.endsWith("Syllabus - Fall.pdf"), weeks: CLASS_WEEKS, breaks: [READING_WEEK], label: label((w) => w) });
    const { id, steps } = await importWith("HAR312", await twelveClasses(), (req) => {
      if (req.system.includes("You are a sharp teaching assistant")) throw new EngineError("ClaudeBusy", "Claude is busy right now.");
      return good(req);
    });
    expect(courseWeekRows(db, id)).toHaveLength(12);
    expect(steps).toContain("The final check couldn't run, so the sorting stays as first read");
    expect(getPlanExtras(db, id).review.at(-1)).toMatch(/^Margin's final check couldn't run \(Claude is busy right now\)/);
  });

  it("a break must follow one of the listed weeks", async () => {
    const { checkCourseMap } = await import("@/lib/import/organize");
    const answer: CourseMapAnswer = { courseCode: null, weeks: CLASS_WEEKS.slice(0, 2), breaks: [{ afterWeek: 7, date: null, title: "Reading Week" }], files: [], missingReadings: [], notInSyllabus: [] };
    expect(checkCourseMap(answer, [])).toEqual(['The break "Reading Week" follows week 7, which is not one of the weeks you listed.']);
  });
});

// ---------------------------------------------------------------- the student's notes and the professor's lecture material

describe("the student's own notes, told apart from the professor's lecture material", () => {
  it("reads the author from a file's own properties (PDF, Word, PowerPoint)", async () => {
    expect((await parseFile("a.pdf", makePdf([[{ text: "Some text on a page here." }]], { author: PROF }))).author).toBe(PROF);
    expect((await parseFile("b.docx", await makeDocx([{ text: "A paragraph." }], { author: STUDENT }))).author).toBe(STUDENT);
    expect((await parseFile("c.pptx", await makePptx([{ title: "A slide" }], undefined, { author: PROF }))).author).toBe(PROF);
    expect((await parseFile("d.docx", await makeDocx([{ text: "No properties." }]))).author).toBeNull();
  });

  const claude = scriptedOrganizer({
    isSyllabus: () => false,
    weeks: weeksOf([["Salt roads"], ["Guild charters"]]),
    label: (p) => {
      const week = p.includes("Lecture 2") ? 2 : 1;
      if (p.endsWith("lec1 stuff.docx")) return { week, type: "my-notes", confidence: "check", reason: `Its author (${STUDENT}) differs from the professor's files and it is written in fragments with arrows and a question to oneself, but it sits in the Lecture 1 folder, so check this.` };
      if (p.endsWith("wk2 notes.pdf")) return { week, type: "my-notes", reason: `Written by ${STUDENT}, not the professor, in short fragments with questions to oneself: the student's own notes.` };
      return { week, type: "lecture", reason: `Posted by ${PROF} for Lecture ${week}.` };
    },
  });

  it("sends each file's author and the clues to weigh; the student's notes go to Lecture notes, the professor's handout into the layers", async () => {
    const { id, mapCall } = await importWith("HAR210", await notesAndHandouts(), claude);
    const { system, prompt } = mapCall[0];
    expect(prompt).toMatch(/### F\d+ \| HAR210\/Lecture 1\/lec1 stuff\.docx\nWord · .* · author in its properties: Sam Okafor/);
    expect(prompt).toMatch(/### F\d+ \| HAR210\/Lecture 1\/HAR210 Lecture 1 key points\.docx\nWord · .* · author in its properties: Dr\. Ilse Varo/);
    expect(prompt).toMatch(/### F\d+ \| HAR210\/Lecture 2\/HAR210 Lecture 2 slides\.pdf\nPDF · .* · author in its properties: Dr\. Ilse Varo/);
    expect(prompt).toContain("salt -> ports (why here??)"); // the writing itself is there to judge
    expect(system).toContain("students often join Margin mid-semester with their own notes already typed up as Word files or PDFs");
    for (const clue of ["The author in the file's properties, compared with the other files", "Personal notes use abbreviations, arrows", "a \"Notes View\" or \"Notes Page\" export", "Folder and file names"]) expect(system).toContain(clue);

    // the professor's lecture-notes handout is lecture material: in the week's layers, never in Lecture notes
    expect(fileAt(id, "HAR210 Lecture 1 key points.docx")).toMatchObject({ type: "lecture", category: "course", role: "lecture", week: 1, author: PROF });
    expect(db.select().from(s.passages).where(eq(s.passages.fileId, fileAt(id, "HAR210 Lecture 1 key points.docx").id)).all().length).toBeGreaterThan(0);
    // the student's notes go to that week's Lecture notes, never into layers; the unsure one is marked "check this" with the clues
    expect(fileAt(id, "lec1 stuff.docx")).toMatchObject({ type: "my-notes", category: "notes", week: 1, needsCheck: true, reason: expect.stringContaining("fragments with arrows") });
    expect(fileAt(id, "wk2 notes.pdf")).toMatchObject({ type: "my-notes", category: "notes", week: 2, needsCheck: false });
    expect(getWeekNotes(db, id, 1).blocks.map((b) => b.text)).toEqual(["From lec1 stuff.docx", "salt -> ports (why here??)", "brine boiled = cheap, roads already there", "tax $$ -> walls/piers", "ask in tutorial: who collected the tax?"]);
    expect(getWeekNotes(db, id, 1).blocks.some((b) => b.text.includes("brine could be boiled cheaply"))).toBe(false);
    expect(db.select().from(s.passages).where(eq(s.passages.fileId, fileAt(id, "lec1 stuff.docx").id)).all()).toEqual([]);
  });

  it("relabelled as lecture material, a file takes its copy out of Lecture notes; what the student wrote there stays", async () => {
    const { id } = await importWith("HAR210", await notesAndHandouts(), claude);
    const f = fileAt(id, "lec1 stuff.docx");
    saveWeekNotes(db, id, 1, [...getWeekNotes(db, id, 1).blocks, { type: "paragraph", text: "my own line typed in Margin" }]);
    relabelFile(db, id, f.id, { type: "lecture" });
    expect(getWeekNotes(db, id, 1).blocks).toEqual([{ type: "paragraph", text: "my own line typed in Margin" }]);
    expect(db.select().from(s.noteImports).where(eq(s.noteImports.fileId, f.id)).all()).toEqual([]);
    expect(fileAt(id, "lec1 stuff.docx")).toMatchObject({ type: "lecture", category: "course", week: 1 });
    expect(db.select().from(s.passages).where(eq(s.passages.fileId, f.id)).all().length).toBeGreaterThan(0);
  });

  it("a copy left in Lecture notes from before (lecture material once read as notes) is taken out when the database opens", async () => {
    const { id } = await importWith("HAR210", await notesAndHandouts(), claude);
    const handout = fileAt(id, "HAR210 Lecture 1 key points.docx");
    importNotesFile(db, id, handout, 1); // how a Notes View export ended up in Lecture notes before this round
    expect(getWeekNotes(db, id, 1).blocks.some((b) => b.text === "From HAR210 Lecture 1 key points.docx")).toBe(true);
    removeStrayNoteCopies(db);
    expect(getWeekNotes(db, id, 1).blocks.map((b) => b.text)).toEqual(["From lec1 stuff.docx", "salt -> ports (why here??)", "brine boiled = cheap, roads already there", "tax $$ -> walls/piers", "ask in tutorial: who collected the tax?"]);
    expect(db.select().from(s.noteImports).where(eq(s.noteImports.fileId, handout.id)).all()).toEqual([]);
    expect(db.select().from(s.noteImports).where(eq(s.noteImports.fileId, fileAt(id, "lec1 stuff.docx").id)).all()).toHaveLength(1); // real notes stay
  });

  it("the final check can mark a notes-looking file to check", async () => {
    const { id } = await importWith("HAR210", await notesAndHandouts(), scriptedOrganizer({
      isSyllabus: () => false,
      weeks: weeksOf([["Salt roads"], ["Guild charters"]]),
      label: (p) => ({ week: p.includes("Lecture 2") ? 2 : 1, type: "lecture" }),
      check: (idOf) => ({ weeks: null, breaks: null, missingReadings: null, files: [{ file: idOf("wk2 notes.pdf"), week: 2, type: "my-notes", confidence: "check", reason: `Labelled lecture material, but its author is ${STUDENT}, not the professor, and it reads like personal notes; check this.` }], notes: [] }),
    }));
    expect(fileAt(id, "wk2 notes.pdf")).toMatchObject({ type: "my-notes", needsCheck: true, reason: expect.stringContaining(STUDENT) });
  });
});
