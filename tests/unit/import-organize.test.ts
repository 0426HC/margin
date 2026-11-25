// @vitest-environment node
/**
 * Import: Claude reads the syllabus and the folder; Margin's code measures the files, sends them, checks the answer and stores it. Each
 * made-up course below is organised differently; Claude's part is played by a scripted answer (what a careful reader would say), so
 * these tests check what the code sends and what it does with each answer. The fake engine and a temporary data folder only.
 */
import { and, eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AiRequest } from "@/lib/ai/engine";
import { FakeEngine } from "@/lib/ai/fake-engine";
import type { CourseMapAnswer } from "@/lib/ai/schemas";
import { openDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { parseFile } from "@/lib/import/parse";
import { checkCourseMap, folderTree, measure } from "@/lib/import/organize";
import { getStructure, proposeStructure } from "@/lib/layers/service";
import { courseWeekRows } from "@/lib/projects/course-import";
import { getPlanExtras } from "@/lib/projects/plan-page";
import { relabelFile } from "@/lib/projects/relabel";
import { addFile, analyzeProject, createProject } from "@/lib/projects/service";
import { getWeekNotes } from "@/lib/weeks/notes";
import type { CourseFile } from "../fixtures/courses";
import { datesOnly, lectureNumbers, longReadingPdf, numberedWeeks, tableAndNotes, wordsAndReadingWeek, WORDS_SYLLABUS } from "../fixtures/varied-courses";
import { scriptedOrganizer, sentPaths, weeksOf, type ScriptedLabel } from "./helpers/organizer";

let db: Db;
beforeAll(() => {
  process.env.MARGIN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "margin-organize-"));
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
  const mapCall = engine.calls.filter((c) => c.system.includes("You organise a university student's course folder"));
  return { id, engine, steps, mapCall };
}
const fileAt = (id: string, end: string) => db.select().from(s.files).where(eq(s.files.projectId, id)).all().find((f) => f.relPath.endsWith(end))!;
const byPath = (labels: Record<string, ScriptedLabel>) => (p: string) => {
  const hit = Object.entries(labels).find(([end]) => p.endsWith(end));
  if (!hit) throw new Error(`no scripted label for ${p}`);
  return hit[1];
};

describe("what Margin measures and sends", () => {
  it("counts the words of the whole file, so a long reading never looks like slides", async () => {
    const parsed = await parseFile("Varnel.pdf", longReadingPdf(25, ["harbour", "inland", "varnel"]));
    const m = measure(parsed);
    expect(m.pages).toBe(25);
    expect(m.words).toBeGreaterThan(9_000); // the whole file, not its first few thousand characters
    expect(m.wordsPerPage).toBeGreaterThan(350);
    expect(m.opening.split(/\s+/).length).toBeLessThanOrEqual(1_502);
  });

  it("shows every folder and file name as a tree", () => {
    expect(folderTree(["C/Week 2/b.pdf", "C/Week 1/a.pdf", "C/syllabus.md"], new Set(["C/Week 2/b.pdf"]))).toBe("C/\n  syllabus.md\n  Week 1/\n    a.pdf\n  Week 2/\n    b.pdf (NEW)");
  });
});

describe("checking Claude's answer", () => {
  const answer = (files: CourseMapAnswer["files"], weeks = [1, 2]): CourseMapAnswer => ({ courseCode: null, weeks: weeks.map((week) => ({ week, date: null, title: "", kind: "class", syllabus: "" })), breaks: [], files, missingReadings: [], notInSyllabus: [] });
  const f = (file: string, week: number | null, type: CourseMapAnswer["files"][number]["type"] = "reading") => ({ file, week, type, confidence: "sure" as const, reason: "Because.", pages: [] });

  it("accepts an answer that labels every file once, inside the course's weeks", () => {
    expect(checkCourseMap(answer([f("F1", 1), f("F2", null, "syllabus"), f("F3", 2, "lecture")]), ["F1", "F2", "F3"])).toEqual([]);
  });
  it("lists every problem in words Claude can act on", () => {
    const problems = checkCourseMap(answer([f("F1", 1), f("F1", 2), f("F4", 1), f("F5", 7), f("F6", null, "lecture"), f("F7", 1, "syllabus")]), ["F1", "F2", "F5", "F6", "F7"]);
    expect(problems.join("\n")).toMatch(/These files have no entry: F2/);
    expect(problems.join("\n")).toMatch(/more than one entry: F1/);
    expect(problems.join("\n")).toMatch(/not files you were asked to label: F4/);
    expect(problems.join("\n")).toMatch(/F5 is put in week 7, which is not one of the weeks you listed/);
    expect(problems.join("\n")).toMatch(/F6 is course material \(lecture\) but has no week/);
    expect(problems.join("\n")).toMatch(/F7 is the syllabus, so its week must be null/);
  });
  it("for new files, the weeks are the course's own", () => {
    expect(checkCourseMap(answer([f("F1", 9)], []), ["F1"], { courseWeeks: [1, 2, 3] })).toEqual(["F1 is put in week 9, which is not one of the course's existing weeks."]);
  });
});

describe("course 1: weeks as numbers, one folder per week", () => {
  it("stores the weeks and labels, and cuts only course material into units by week", async () => {
    const { id, mapCall, steps } = await importWith("HIS210", await numberedWeeks(), scriptedOrganizer({
      isSyllabus: (p) => p.endsWith("syllabus.txt"),
      courseCode: "HIS210",
      weeks: weeksOf([["Ports before empire", "Jan 8"], ["The customs house", "Jan 15"], ["Harbour cities at war", "Jan 22"]]),
      label: byPath({
        "syllabus.txt": { week: null, type: "syllabus", reason: "The course syllabus." },
        "Orlen ch1.pdf": { week: 1, type: "reading", reason: "Listed in the syllabus under Week 1 as Orlen, Salt Roads, ch. 1." },
        "Week 1 slides.pptx": { week: 1, type: "lecture", reason: "In the Week 1 folder; a slide deck." },
        "Tavi.pdf": { week: 2, type: "reading", reason: "Listed under Week 2 as Tavi, Ledgers of the Coast." },
        "Orlen ch4.pdf": { week: 3, type: "reading", reason: "Listed under Week 3 as Orlen, Salt Roads, ch. 4." },
      }),
    }));
    expect(mapCall).toHaveLength(1);
    expect(mapCall[0]).toMatchObject({ model: "claude-opus-5-5", effort: "medium" });
    expect(courseWeekRows(db, id).map((w) => [w.week, w.date, w.title])).toEqual([[1, "Jan 8", "Ports before empire"], [2, "Jan 15", "The customs house"], [3, "Jan 22", "Harbour cities at war"]]);
    expect(fileAt(id, "Orlen ch1.pdf")).toMatchObject({ type: "reading", category: "course", role: "reading", week: 1, needsCheck: false, reason: "Listed in the syllabus under Week 1 as Orlen, Salt Roads, ch. 1." });
    expect(fileAt(id, "Week 1 slides.pptx")).toMatchObject({ type: "lecture", role: "lecture", week: 1 });
    const units = db.select().from(s.units).where(eq(s.units.projectId, id)).all().sort((a, b) => a.position - b.position).map((u) => u.title);
    expect(units).toEqual(["Course overview", "Week 1: Ports before empire", "Week 2: The customs house", "Week 3: Harbour cities at war"]);
    expect(db.select().from(s.projects).where(eq(s.projects.id, id)).get()!.courseCode).toBe("HIS210");
    // progress in plain words, from looking at the folder to cutting passages
    expect(steps[0]).toMatch(/^Looking at the 5 files/);
    expect(steps).toContain("Looking through the folder for the syllabus");
    expect(steps.some((x) => /^Reading the syllabus and matching all 5 files to its weeks/.test(x))).toBe(true);
    expect(steps.at(-1)).toBe("Done");
  });
});

describe("course 2: classes in words, a reading week, a flat folder of long readings with no clue words", () => {
  const claude = scriptedOrganizer({
    isSyllabus: (p) => p.startsWith("Course outline"),
    weeks: weeksOf([
      ["Origins of the coast", "September 8"],
      ["Fishermen and lords", "September 15"],
      ["The great migration", "September 22"],
      ["Islands under siege", "October 6"],
      ["Midterm test", "October 13", "exam"],
    ]),
    breaks: [{ afterWeek: 3, date: "September 29", title: "Fall Reading Week" }],
    label: byPath({
      "Course outline GRK385.pdf": { week: null, type: "syllabus" },
      "Varnel - The Harbour World and Its Inland Roads.pdf": { week: 1, type: "reading", reason: "Listed in the syllabus under Class One as Varnel, Stone Harbours, pp. 1-24; the file is 25 pages of dense text." },
      "Varnel - The Great Migration.pdf": { week: 3, type: "reading", reason: "Listed under Class Three as Varnel, Stone Harbours, pp. 25-55." },
      "Quill_net_crown.pdf": { week: 2, type: "reading", reason: "Listed under Class Two as Quill, The Net and the Crown." },
      "slides-0915.pdf": { week: 2, type: "lecture", reason: "Dated 15 September (Class Two); 18 pages with few words each, so slides." },
      "slides-1006.pptx": { week: 4, type: "lecture", confidence: "check", reason: "Dated 6 October, Class Four (after the reading week); not named in the syllabus, so check this." },
    }),
    missingReadings: [{ week: 4, reading: "Hesk, The Island Wars (selections)" }],
    notInSyllabus: (p) => p.includes("slides-"),
  });

  it("sends the full syllabus, the folder tree and real words per page; stores Claude's weeks, labels and what it couldn't find", async () => {
    const { id, mapCall } = await importWith("GRK385", await wordsAndReadingWeek(), claude);
    const prompt = mapCall[0].prompt;
    for (const line of WORDS_SYLLABUS.split("\n")) expect(prompt).toContain(line); // in full, line by line ("Class Four" included)
    expect(prompt).toContain("Varnel - The Harbour World and Its Inland Roads.pdf\n");
    const varnel = /### F\d+ \| Varnel - The Harbour World and Its Inland Roads\.pdf\nPDF · 25 pages · ([\d,]+) words in the whole file · ([\d,]+) words per page/.exec(prompt)!;
    expect(Number(varnel[2].replace(/,/g, ""))).toBeGreaterThan(350);
    const slides = /### F\d+ \| slides-0915\.pdf\nPDF · 18 pages · [\d,]+ words in the whole file · ([\d,]+) words per page/.exec(prompt)!;
    expect(Number(slides[1].replace(/,/g, ""))).toBeLessThan(20);

    expect(courseWeekRows(db, id).map((w) => [w.week, w.kind])).toEqual([[1, "class"], [2, "class"], [3, "class"], [4, "class"], [5, "exam"]]);
    expect(fileAt(id, "Varnel - The Harbour World and Its Inland Roads.pdf")).toMatchObject({ type: "reading", week: 1 });
    expect(fileAt(id, "slides-1006.pptx")).toMatchObject({ type: "lecture", week: 4, needsCheck: true });
    const extras = getPlanExtras(db, id);
    expect(extras).toMatchObject({ check: 1, unlabelled: 0, failed: null, notInSyllabus: 2, missingReadings: [{ week: 4, reading: "Hesk, The Island Wars (selections)" }] });
    expect(extras.review).toEqual(["Fall Reading Week (September 29) sits between week 3 and week 4. It is a break, not a week of its own."]);
    expect(extras.files.find((f) => f.name === "slides-1006.pptx")).toMatchObject({ check: true, reason: expect.stringContaining("Class Four") });
  });

  it("the student's change clears 'check this' and says they set it", async () => {
    const { id } = await importWith("GRK385", await wordsAndReadingWeek(), claude);
    const f = fileAt(id, "slides-1006.pptx");
    relabelFile(db, id, f.id, { week: 4 });
    expect(fileAt(id, "slides-1006.pptx")).toMatchObject({ week: 4, needsCheck: false, reason: "You set this." });
  });

  it("the plan reads each week's full text with its title and what the syllabus says, and enforces two layers for a real week", async () => {
    const { id, engine } = await importWith("GRK385", await wordsAndReadingWeek(), claude);
    await proposeStructure(db, engine, id);
    const plans = engine.calls.filter((c) => c.system.includes("CHAIN OF IDEAS"));
    const week1 = plans.find((c) => c.prompt.split("\n")[1] === "Week 1 · Origins of the coast")!;
    expect(week1.prompt).toContain("Course: GRK385");
    expect(week1.prompt).toContain("The syllabus says about this week: Origins of the coast");
    const first = db.select({ t: s.passages.text }).from(s.passages).innerJoin(s.files, eq(s.files.id, s.passages.fileId)).where(and(eq(s.passages.projectId, id), eq(s.files.name, "Varnel - The Harbour World and Its Inland Roads.pdf"))).all()[3].t;
    expect(week1.prompt).toContain(first); // whole passages, not the first few words
    expect(week1.system).toMatch(/- 2 to 5 layers/);
    // a week with 1,500 words or more has at least two layers; a light week (week 4: one short slide deck) may have one
    for (const w of getStructure(db, id)!.weeks.filter((x) => x.layers.length)) expect(w.layers.length).toBeGreaterThanOrEqual(w.words >= 1_500 ? 2 : 1);
    expect(getStructure(db, id)!.weeks[3]).toMatchObject({ layers: [expect.anything()] });
  });
});

describe("course 3: dates only, Readings and Lectures folders", () => {
  it("weeks come from the dates; a week can have no title of its own", async () => {
    const { id } = await importWith("ECO150", await datesOnly(), scriptedOrganizer({
      isSyllabus: (p) => p.endsWith("Syllabus.md"),
      weeks: [
        { week: 1, date: "Sept 9", title: "What a market is", kind: "class", syllabus: "Sept 9 — What a market is. Mirr, chapter 2." },
        { week: 2, date: "Sept 16", title: "Prices and fairness", kind: "class", syllabus: 'Sept 16 — Prices and fairness. Dolan, "The Fair Price".' },
        { week: 3, date: "Sept 23", title: "Debt and promise", kind: "class", syllabus: 'Sept 23 — Debt and promise. Mirr, chapter 5; Ostra, "Owing".' },
      ],
      label: byPath({
        "Syllabus.md": { week: null, type: "syllabus" },
        "Mirr ch2.pdf": { week: 1, type: "reading" },
        "Dolan The Fair Price.pdf": { week: 2, type: "reading" },
        "Mirr ch5.pdf": { week: 3, type: "reading" },
        "sep09.pdf": { week: 1, type: "lecture", reason: "In Lectures and named for 9 September, the first class." },
        "sep16.pdf": { week: 2, type: "lecture" },
      }),
      missingReadings: [{ week: 3, reading: 'Ostra, "Owing"' }],
    }));
    expect(fileAt(id, "Lectures/sep09.pdf")).toMatchObject({ type: "lecture", role: "lecture", week: 1, reason: "In Lectures and named for 9 September, the first class." });
    expect(getStructure(db, id)!.weeks.map((w) => w.label)).toEqual(["Week 1 · What a market is", "Week 2 · Prices and fairness", "Week 3 · Debt and promise"]);
    expect(getPlanExtras(db, id).missingReadings).toEqual([{ week: 3, reading: 'Ostra, "Owing"' }]);
  });
});

describe("course 4: lecture numbers with a reading week", () => {
  it("Lecture 7 after the reading week is week 7: the course's own numbering, with the break between weeks 6 and 7", async () => {
    const { id, mapCall } = await importWith("PHI220", await lectureNumbers(), scriptedOrganizer({
      isSyllabus: (p) => p.endsWith("outline.docx"),
      weeks: weeksOf([["Care as a practice"], ["Dependence"], ["Attention"], ["Vulnerability"], ["Justice and care"], ["Midterm review"], ["Care at work"], ["Care and the state"]]),
      breaks: [{ afterWeek: 6, date: null, title: "Reading week" }],
      label: byPath({
        "outline.docx": { week: null, type: "syllabus" },
        "L06.pptx": { week: 6, type: "lecture", reason: "In the L06 folder: Lecture 6." },
        "L07.pptx": { week: 7, type: "lecture", reason: "In the L07 folder: Lecture 7, after the reading week." },
        "Brenn - Paid Care.pdf": { week: 7, type: "reading", confidence: "check", reason: "In the Lecture 7 folder, but the syllabus lists no readings; check this." },
      }),
    }));
    expect(mapCall[0].prompt).toContain("Reading week (no lectures)");
    expect(mapCall[0].prompt).toContain("PHI220/\n  L06 - Midterm review/\n    L06.pptx\n  L07 - Care at work/");
    expect(fileAt(id, "L07.pptx")).toMatchObject({ week: 7 });
    expect(courseWeekRows(db, id).map((w) => w.week)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(getStructure(db, id)!.weekCount).toBe(8);
  });
});

describe("course 5: a schedule table, the professor's notes exports, the student's own notes", () => {
  it("professor notes are lecture material in layers; the student's notes go to Lecture notes and never into layers", async () => {
    const { id, mapCall } = await importWith("SOC330", await tableAndNotes(), scriptedOrganizer({
      isSyllabus: (p) => p.endsWith("course info.md"),
      weeks: weeksOf([["The stranger", "Jan 10"], ["Neighbours", "Jan 17"], ["Public space", "Jan 24"]]),
      label: byPath({
        "course info.md": { week: null, type: "syllabus" },
        "Simmet.pdf": { week: 1, type: "reading" },
        "Akka ch1-2.pdf": { week: 2, type: "reading" },
        "Week 2 Notes View.pdf": { week: 2, type: "lecture", reason: "A Notes View export of the Week 2 slides: the professor's lecture notes." },
        "Week 3 Notes Page.pdf": { week: 3, type: "lecture" },
        "wk2.md": { week: 2, type: "my-notes", reason: "In My notes; the student's own notes for week 2." },
      }),
      missingReadings: [{ week: 3, reading: 'Loury, "Benches"' }],
    }));
    expect(mapCall[0].prompt).toContain("| 2 | Jan 17 | Neighbours | Akka, *Close Quarters*, ch. 1-2 |"); // the table arrives with its lines
    expect(fileAt(id, "Week 2 Notes View.pdf")).toMatchObject({ type: "lecture", category: "course", role: "lecture", week: 2 });
    expect(fileAt(id, "wk2.md")).toMatchObject({ type: "my-notes", category: "notes", unitId: null });
    expect(getWeekNotes(db, id, 2).blocks[0]).toEqual({ type: "heading", text: "From wk2.md" });
    const notesId = fileAt(id, "Week 2 Notes View.pdf").id;
    expect(db.select().from(s.passages).where(eq(s.passages.fileId, notesId)).all().length).toBeGreaterThan(0);
    expect(db.select().from(s.passages).where(eq(s.passages.fileId, fileAt(id, "wk2.md").id)).all()).toEqual([]);
  });
});

describe("exact copies and failures", () => {
  it("the same bytes twice is read once, sent once with where its copy sits; a different file with the same name is its own file", async () => {
    const reading = longReadingPdf(3, ["copy", "same", "bytes"]);
    const files: CourseFile[] = [
      { relPath: "C/Week 1/Reading.pdf", bytes: reading },
      { relPath: "C/Midterm/Reading.pdf", bytes: reading },
      { relPath: "C/Week 2/Reading.pdf", bytes: longReadingPdf(3, ["other", "text", "entirely"]) },
    ];
    const { id, mapCall } = await importWith("C", files, scriptedOrganizer({ isSyllabus: () => false, weeks: weeksOf([["One"], ["Two"]]), label: (p) => ({ week: p.includes("Week 2") ? 2 : 1, type: "reading" }) }));
    expect(sentPaths(mapCall[0])).toEqual(["C/Midterm/Reading.pdf", "C/Week 2/Reading.pdf"]); // the first copy in folder order
    expect(mapCall[0].prompt).toContain("The same file is also in the folder as: C/Week 1/Reading.pdf");
    expect(mapCall[0].prompt).toContain("Week 1/\n    Reading.pdf"); // and in the tree a person sees
    expect(fileAt(id, "Week 1/Reading.pdf")).toMatchObject({ category: "duplicate", week: 1, unitId: null });
    expect(fileAt(id, "Midterm/Reading.pdf")).toMatchObject({ category: "course", week: 1 });
    expect(fileAt(id, "Week 2/Reading.pdf")).toMatchObject({ category: "course", week: 2 });
  });

  it("a bad answer is sent back once with its problems listed, and the second answer is used", async () => {
    let calls = 0;
    const good = scriptedOrganizer({ isSyllabus: () => false, weeks: weeksOf([["One"]]), label: () => ({ week: 1, type: "reading" }) });
    const { id, mapCall, steps } = await importWith("R", [{ relPath: "R/a.pdf", bytes: longReadingPdf(2, ["a", "b", "c"]) }], (req) => {
      const out = good(req) as CourseMapAnswer;
      if (!req.system.includes("You organise")) return out;
      return calls++ === 0 ? { ...out, files: [{ ...out.files[0], week: 4 }] } : out;
    });
    expect(mapCall).toHaveLength(2);
    expect(mapCall[1].prompt).toContain("Your last answer was rejected: F1 is put in week 4, which is not one of the weeks you listed.");
    expect(steps).toContain("Claude's answer had problems, so Margin is asking once more");
    expect(fileAt(id, "a.pdf")).toMatchObject({ week: 1, type: "reading" });
  });

  it("two bad answers leave every file unlabelled, with a clear message, and the student can label them", async () => {
    const { id, mapCall } = await importWith("U", [{ relPath: "U/a.pdf", bytes: longReadingPdf(2, ["a", "b", "c"]) }, { relPath: "U/b.pdf", bytes: longReadingPdf(2, ["d", "e", "f"]) }], (req) =>
      req.system.includes("find the SYLLABUS") ? { syllabus: [] } : { courseCode: null, weeks: [], files: [{ file: "F1", week: null, type: "reading", confidence: "sure", reason: "x x x" }], missingReadings: [], notInSyllabus: [] },
    );
    expect(mapCall).toHaveLength(2);
    const extras = getPlanExtras(db, id);
    expect(extras).toMatchObject({ unlabelled: 2, askWeekCount: true });
    expect(extras.failed).toMatch(/^Claude's answer didn't fit the files twice \(These files have no entry: F2/);
    expect(extras.files.every((f) => f.type === null && f.week === null)).toBe(true);
    expect(db.select().from(s.passages).where(eq(s.passages.projectId, id)).all()).toEqual([]); // nothing cut until labelled
    // the student labels a file: it is cut into passages in its week
    relabelFile(db, id, extras.files[0].id, { week: 1, type: "reading" });
    expect(db.select().from(s.passages).where(eq(s.passages.fileId, extras.files[0].id)).all().length).toBeGreaterThan(0);
  });

  it("when Claude can't be reached at all, the files are left unlabelled with Claude's own message", async () => {
    const { EngineError } = await import("@/lib/ai/errors");
    const { id } = await importWith("X", [{ relPath: "X/a.pdf", bytes: longReadingPdf(2, ["a", "b", "c"]) }], () => {
      throw new EngineError("ClaudeNotLoggedIn", "Claude Code isn't logged in. Run `claude` in a terminal, type /login, then try again.");
    });
    expect(getPlanExtras(db, id).failed).toBe("Claude Code isn't logged in. Run `claude` in a terminal, type /login, then try again.");
  });
});
