import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { cannedEngine, cannedJson } from "@/lib/ai/canned";
import { scriptedOrganizer, weeksOf } from "./helpers/organizer";
import type { AiRequest } from "@/lib/ai/engine";
import { FakeEngine } from "@/lib/ai/fake-engine";
import { openDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { fullReading, weekReadings } from "@/lib/layers/full-reading";
import { getNoteToSelf } from "@/lib/layers/note-to-self";
import { approvePlan, getLayer, getStructure, proposeStructure, writeLayerContent } from "@/lib/layers/service";
import { FAR_OVER, MAX_LAYERS_PER_WEEK } from "@/lib/layers/week-shape";
import { getThread, saveSynthesis, submitSynthesis } from "@/lib/layers/writeback";
import { getPlanExtras } from "@/lib/projects/plan-page";
import { addFile, analyzeProject, createProject } from "@/lib/projects/service";
import { anyLength, pol326Real, type CourseFile } from "../fixtures/courses";

// A POL326-style course as it really arrives (lecture folders with textbook chapters, court cases and lecture docx files; a syllabus with
// each week's title; extra readings; a folder of copies and a review guide), planned week by week with the fake engine. Temporary data only.

beforeAll(() => {
  process.env.MARGIN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "margin-pol326-"));
});

/** What Claude reads in this folder: the syllabus's twelve weeks, each lecture folder's chapter or cases as readings and the professor's
 * "POL326 Lecture #N.docx" as lecture material, the extra readings as optional (with the weeks the syllabus gives), the guide as exam material. */
const pol326Claude = scriptedOrganizer({
  isSyllabus: (p) => p.endsWith("Syllabus.pdf"),
  weeks: weeksOf([
    ["The presidency in the Constitution", "Sept 9"],
    ["Power and persuasion", "Sept 16"],
    ["Foreign affairs and the courts", "Sept 23"],
    ["Congress and the president", "Sept 30"],
    ["The president in political time", "Oct 7"],
    ["Midterm exam, in class", "Oct 14", "exam"],
    ["Reading week, no class", "Oct 21", "no-class"],
    ["War powers", "Oct 28"],
    ["The courts and the president", "Nov 4"],
    ["Parties", "Nov 11"],
    ["The unitary executive", "Nov 18"],
    ["Review", "Nov 25"],
  ]),
  label: (p) => {
    if (p.endsWith("Syllabus.pdf")) return { week: null, type: "syllabus" };
    if (p.includes("Midterm Focus/")) return { week: 6, type: "exam" };
    if (p.includes("Neustadt revisited")) return { week: 2, type: "optional" };
    if (p.includes("Halberstam")) return { week: 8, type: "optional" };
    const week = Number(/Lecture 0(\d)/.exec(p)![1]);
    return { week, type: p.endsWith(".docx") ? "lecture" : "reading" };
  },
});

async function importCourse(db: Db, name: string, files: CourseFile[], answer: (req: AiRequest) => unknown = cannedJson) {
  const id = createProject(db, { name });
  for (const f of files) await addFile(db, id, { name: f.relPath.split("/").pop()!, relPath: `${name}/${f.relPath}`, bytes: f.bytes });
  await analyzeProject(db, new FakeEngine({ json: answer }), id);
  return id;
}

let db: Db;
let id: string;
let files: CourseFile[];
const row = (relPathEnd: string) => db.select().from(s.files).where(eq(s.files.projectId, id)).all().find((f) => f.relPath.endsWith(relPathEnd))!;
/** Plan the course again from scratch (the tests share one imported course; an earlier test may have approved its plan). */
const plan = async (engine = cannedEngine()) => {
  db.update(s.parts).set({ breakdownStatus: "proposed", approvedAt: null }).where(eq(s.parts.projectId, id)).run();
  await proposeStructure(db, engine, id);
};
const wordsOf = (layerId: string) => db.select({ t: s.passages.text }).from(s.layerPassages).innerJoin(s.passages, eq(s.passages.id, s.layerPassages.passageId)).where(eq(s.layerPassages.layerId, layerId)).all().reduce((n, r) => n + r.t.split(/\s+/).filter(Boolean).length, 0);

beforeAll(async () => {
  files = await pol326Real();
  db = openDb(":memory:").db;
  id = await importCourse(db, "POL326", files, pol326Claude);
}, 120_000);

describe("file types follow Claude's reading", () => {
  it("textbook chapters and court cases in a lecture folder are Readings; POL326 Lecture #3.docx is the professor's lecture material", () => {
    expect(row("Lecture 03 - Foreign Affairs/Ch09 Foreign Policy.pdf")).toMatchObject({ category: "course", role: "reading", week: 3 });
    expect(row("Lecture 03 - Foreign Affairs/United States v. Curtiss-Wright.pdf")).toMatchObject({ category: "course", role: "reading", week: 3 });
    expect(row("Lecture 03 - Foreign Affairs/Youngstown Sheet & Tube Co. v. Sawyer.pdf")).toMatchObject({ category: "course", role: "reading", week: 3 });
    expect(row("Lecture 03 - Foreign Affairs/POL326 Lecture #3.docx")).toMatchObject({ category: "course", type: "lecture", role: "lecture", week: 3 });
    expect(row("Lecture 01 - The Constitutional Presidency/Ch01 The Constitutional Presidency.pdf")).toMatchObject({ role: "reading", week: 1 });
  });
});

describe("exact copies and the review guide", () => {
  it("copies in Midterm Focus (the same bytes) are used once, in their week folder, and never sent to Claude; the guide is exam material", () => {
    expect(row("Midterm Focus/Ch09 Foreign Policy.pdf")).toMatchObject({ category: "duplicate", unitId: null });
    expect(row("Midterm Focus/Youngstown Sheet & Tube Co. v. Sawyer.pdf")).toMatchObject({ category: "duplicate", unitId: null });
    expect(row("Midterm Focus/00 - POL326 Midterm Focus Guide.md")).toMatchObject({ category: "exam", type: "exam", unitId: null });
    // a copy is never cut into passages, so it can never land in a layer twice
    for (const f of ["Midterm Focus/Ch09 Foreign Policy.pdf", "Midterm Focus/Youngstown Sheet & Tube Co. v. Sawyer.pdf"]) expect(db.select().from(s.passages).where(eq(s.passages.fileId, row(f).id)).all()).toEqual([]);
  });

  it("the summary and the files list do not count the copies", () => {
    const extras = getPlanExtras(db, id);
    expect(extras.files.map((f) => f.name)).not.toContain(undefined);
    expect(extras.files.filter((f) => f.name === "Ch09 Foreign Policy.pdf")).toHaveLength(1);
    expect(extras.files).toHaveLength(files.length - 2);
    expect(extras.summary).toMatch(new RegExp(`^${files.length - 2} files: 5 weeks of lectures and readings, the syllabus, 2 optional readings, 1 exam file\\. 2 files were exact copies of others and are used once\\.$`));
  });
});

describe("weeks from the syllabus", () => {
  it("12 weeks, each titled from the schedule; weeks without material say so", async () => {
    await plan();
    const st = getStructure(db, id)!;
    expect(st.weekCount).toBe(12);
    expect(st.weeks.slice(0, 5).map((w) => w.label)).toEqual(["Week 1 · The presidency in the Constitution", "Week 2 · Power and persuasion", "Week 3 · Foreign affairs and the courts", "Week 4 · Congress and the president", "Week 5 · The president in political time"]);
    expect(st.weeks.slice(5).map((w) => [w.label, w.layers.length])).toEqual([
      ["Week 6 · Midterm exam, in class", 0],
      ["Week 7 · Reading week, no class", 0],
      ["Week 8 · War powers", 0],
      ["Week 9 · The courts and the president", 0],
      ["Week 10 · Parties", 0],
      ["Week 11 · The unitary executive", 0],
      ["Week 12 · Review", 0],
    ]);
    // weeks in week order, and each week's layers only from that week's files
    for (const w of st.weeks.filter((x) => x.layers.length)) for (const l of w.layers) expect(l.weeks).toEqual([w.week]);
  });
});

describe("layers follow each week's ideas, within the size limit", () => {
  it("week 3 (a chapter, two long court cases and the lecture) never becomes one giant layer: at most five, none far over the limit", async () => {
    await plan();
    const week3 = getStructure(db, id)!.weeks[2];
    const total = week3.layers.reduce((n, l) => n + wordsOf(l.id), 0);
    expect(total).toBeGreaterThan(40_000);
    expect(week3.layers.length).toBeLessThanOrEqual(MAX_LAYERS_PER_WEEK);
    for (const l of week3.layers) expect(wordsOf(l.id)).toBeLessThanOrEqual(FAR_OVER);
  });

  it("even if the model puts the whole week into one layer, code splits it, and long court cases split by their parts", async () => {
    const lazy = new FakeEngine({
      json: (req: AiRequest) => {
        if (!req.system.includes("CHAIN OF IDEAS")) return cannedJson(req);
        const n = [...req.prompt.matchAll(/^#(\d+) \|/gm)].length;
        return { layers: [{ title: "Everything this week", bigQuestion: "What does this week teach?", buildsOn: "", ranges: [{ from: 1, to: n }] }] };
      },
    });
    // the plan prompt marks where each court-case part starts
    await plan(lazy);
    const prompt = lazy.calls.find((c) => c.prompt.split("\n")[1]?.startsWith("Week 3"))!.prompt;
    for (const part of ["STARTS: Opinion of the Court (Sutherland)", "STARTS: McReynolds, dissenting", "STARTS: Frankfurter, concurring", "STARTS: Jackson, concurring in the judgment", "STARTS: Vinson, dissenting"]) expect(prompt).toContain(part);
    const week3 = getStructure(db, id)!.weeks[2];
    expect(week3.layers).toHaveLength(MAX_LAYERS_PER_WEEK);
    for (const l of week3.layers) expect(wordsOf(l.id)).toBeLessThanOrEqual(FAR_OVER);
    // the cuts fall where the texts' real parts begin, and the layers are named for them
    expect(week3.layers.slice(1).some((l) => /: (?:Opinion of the Court|Frankfurter|Jackson|Vinson|McReynolds|Youngstown|United States v)/.test(l.title))).toBe(true);
    // every passage of the week is still in exactly one layer
    const all = db.select().from(s.layerPassages).all();
    expect(new Set(all.map((r) => r.passageId)).size).toBe(all.length);
  });
});

describe("optional readings follow the syllabus and the layer they attach to", () => {
  it("Neustadt revisited (week 2 in the syllabus) sits beside a week 2 layer; Halberstam keeps the syllabus's week 8 though it sits beside an earlier layer", async () => {
    await plan();
    const st = getStructure(db, id)!;
    const weekOfLayer = (fileName: string) => st.weeks.find((w) => w.layers.some((l) => l.extras.includes(fileName)))!.week;
    expect(weekOfLayer("Neustadt revisited.pdf")).toBe(2);
    expect(row("Extra Readings/Neustadt revisited.pdf").week).toBe(2);
    const h = weekOfLayer("Halberstam - The Best and the Brightest.pdf");
    expect(h).toBeLessThanOrEqual(5); // never a week past the material
    expect(row("Extra Readings/Halberstam - The Best and the Brightest.pdf").week).toBe(8); // what Claude read in the syllabus is never overwritten
  });
});

describe("inside a layer", () => {
  it("Explained starts with a 2-3 sentence summary, then the layer's big question", async () => {
    await plan();
    approvePlan(db, id);
    const layer = getStructure(db, id)!.weeks[0].layers[0];
    await writeLayerContent(db, cannedEngine(), layer.id);
    const explained = getLayer(db, layer.id)!.content!.explained;
    expect(explained.summary.split(/(?<=\.)\s+/).length).toBeGreaterThanOrEqual(2);
    expect(explained.summary.split(/(?<=\.)\s+/).length).toBeLessThanOrEqual(3);
    expect("question" in explained && explained.question).toBe(layer.bigQuestion);
  });

  it("Show full reading lists the week's readings and lecture file once each, and shows any of them in full with the layer's passages marked", async () => {
    await plan();
    const week3 = getStructure(db, id)!.weeks[2];
    const layer = week3.layers[0];
    const list = weekReadings(db, layer.id)!;
    expect(list.map((f) => [f.name, f.role])).toEqual([
      ["Ch09 Foreign Policy.pdf", "Reading"],
      ["POL326 Lecture #3.docx", "Lecture"],
      ["United States v. Curtiss-Wright.pdf", "Reading"],
      ["Youngstown Sheet & Tube Co. v. Sawyer.pdf", "Reading"],
    ]);
    const mine = list.find((f) => f.inLayer > 0)!;
    const view = fullReading(db, layer.id, mine.id)!;
    expect(view.marked).toBe(true);
    // verbatim: the shown text is the stored text, block by block, only split around the marks
    const stored = db.select({ original: s.sections.original }).from(s.sections).where(eq(s.sections.fileId, mine.id)).all().flatMap((x) => x.original.map((b) => b.text));
    expect(view.blocks.map((b) => b.parts.map((p) => p.text).join(""))).toEqual(stored);
    // another of the week's files opens too; one from another week does not
    const other = list.find((f) => f.id !== mine.id)!;
    expect(fullReading(db, layer.id, other.id)).not.toBeNull();
    expect(fullReading(db, layer.id, row("Ch01 The Constitutional Presidency.pdf").id)).toBeNull();
  });
});

describe("the week synthesis", () => {
  it("is optional, reviewed like a write-back, goes to Note to Self under its week, and never counts toward progress", async () => {
    await plan();
    approvePlan(db, id);
    const week3 = () => getStructure(db, id)!.weeks[2];
    const before = getStructure(db, id)!.progress;
    const r = await submitSynthesis(db, cannedEngine(), week3().id!, "The cases show how far the president can act alone abroad and at home.");
    expect(getThread(db, week3().layers[0].id).messages).toEqual([]); // the layers' own chats are untouched
    saveSynthesis(db, week3().id!, r.writebackId, "own");
    expect(week3().synthesis).toBe("saved");
    expect(getStructure(db, id)!.progress).toEqual(before);
    expect(getNoteToSelf(db, id).find((w) => w.week === 3)!.synthesis).toMatchObject({ title: "Week 3 · Foreign affairs and the courts synthesis", version: "own" });
  });
});

describe("any number of weeks", () => {
  it.each([
    [13, 3],
    [14, 2],
    [24, 4],
  ])("a %i-week syllabus gives %i weeks of material and the rest waiting", async (weeks, withFiles) => {
    const d = openDb(":memory:").db;
    const pid = await importCourse(d, `C${weeks}`, anyLength(weeks, withFiles));
    await proposeStructure(d, cannedEngine(), pid);
    const st = getStructure(d, pid)!;
    expect(st.weeks).toHaveLength(weeks);
    expect(st.weeks.map((w) => w.label)).toEqual(Array.from({ length: weeks }, (_, i) => `Week ${i + 1} · Topic ${i + 1}`));
    expect(st.weeks.filter((w) => w.layers.length).map((w) => w.week)).toEqual(Array.from({ length: withFiles }, (_, i) => i + 1));
  });
});
