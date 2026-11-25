import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { cannedEngine, cannedJson } from "@/lib/ai/canned";
import type { AiRequest } from "@/lib/ai/engine";
import { FakeEngine } from "@/lib/ai/fake-engine";
import { openDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { duplicatePairs, sameTitle } from "@/lib/layers/duplicates";
import { addOptionalLayer, approvePlan, getStructure, moveLayerToWeek, proposeStructure, renameWeek } from "@/lib/layers/service";
import { courseWeekRows } from "@/lib/projects/course-import";
import { getPlanExtras } from "@/lib/projects/plan-page";
import { addFile, analyzeProject, createProject } from "@/lib/projects/service";
import { getCourseWeeks } from "@/lib/updates/service";
import { getWeekNotes } from "@/lib/weeks/notes";
import { courseWeekCount, setWeekCount } from "@/lib/weeks/count";
import { noStructure, pol326, tenWeeks, type CourseFile } from "../fixtures/courses";

let db: Db;
beforeEach(() => {
  db = openDb(":memory:").db;
});

async function importCourse(name: string, files: CourseFile[]) {
  const id = createProject(db, { name });
  for (const f of files) await addFile(db, id, { name: f.relPath.split("/").pop()!, relPath: `${name}/${f.relPath}`, bytes: f.bytes });
  await analyzeProject(db, cannedEngine(), id);
  return id;
}
const fileRow = (id: string, name: string) => db.select().from(s.files).where(eq(s.files.projectId, id)).all().find((f) => f.name === name)!;
const asksWeeks = (id: string) => getPlanExtras(db, id).askWeekCount;

// These run on the offline stand-in for Claude (`cannedJson`), which reads a folder like this one the way Claude would. What Margin's
// code does with Claude's answers for very different courses is tested with scripted answers in import-organize.test.ts.
describe("a POL326-style folder imports with zero questions", () => {
  let id: string;
  beforeEach(async () => {
    id = await importCourse("POL326", await pol326());
  });

  it("labels every file: syllabus, lectures and readings by week, optional readings, the review guide, my notes", () => {
    expect(fileRow(id, "Syllabus.pdf")).toMatchObject({ category: "syllabus" });
    for (let w = 1; w <= 5; w++) expect(fileRow(id, `POL326 Lecture ${w}.pptx`)).toMatchObject({ category: "course", type: "lecture", role: "lecture", week: w, needsCheck: false });
    expect(fileRow(id, "Mayhew - The Electoral Connection.pdf")).toMatchObject({ category: "course", type: "reading", role: "reading", week: 3, needsCheck: false });
    expect(fileRow(id, "Halberstam - The Best and the Brightest.pdf")).toMatchObject({ category: "optional" });
    expect(fileRow(id, "Midterm review guide.pdf")).toMatchObject({ category: "exam", type: "exam", unitId: null });
    expect(fileRow(id, "Week 2 notes.docx")).toMatchObject({ category: "notes", week: 2, unitId: null });
  });

  it("knows the course has 12 weeks, a midterm in week 6 and a reading week in week 7, and asks nothing", () => {
    expect(courseWeekCount(db, id)).toBe(12);
    const weeks = courseWeekRows(db, id);
    expect(weeks.find((w) => w.week === 6)).toMatchObject({ kind: "exam", date: "Oct 14" });
    expect(weeks.find((w) => w.week === 7)).toMatchObject({ kind: "no-class" });
    expect(asksWeeks(id)).toBe(false);
  });

  it("copies my notes into week 2's Lecture notes, keeping headings and bullets, and they never become course text", () => {
    const notes = getWeekNotes(db, id, 2).blocks;
    expect(notes).toEqual([
      { type: "heading", text: "From Week 2 notes.docx" },
      { type: "heading", text: "Founding notes" },
      { type: "bullet", text: "Hamilton wants energy in the executive" },
      { type: "bullet", text: "unity -> accountability" },
      { type: "paragraph", text: "Ask about Federalist 70 in seminar." },
    ]);
    const notesFile = fileRow(id, "Week 2 notes.docx");
    expect(db.select().from(s.passages).where(eq(s.passages.fileId, notesFile.id)).all()).toEqual([]);
  });

  it("puts every week's files under its week", () => {
    const weeks = getCourseWeeks(db, id);
    expect(weeks.count).toBe(12);
    expect(weeks.weeks.slice(0, 5).map((w) => [w.week, w.files, w.lectures])).toEqual([[1, 2, 1], [2, 2, 1], [3, 2, 1], [4, 2, 1], [5, 2, 1]]);
  });

  it("groups the course by its 12 weeks, titled from the syllabus; weeks 6 to 12 have no material yet", async () => {
    await proposeStructure(db, cannedEngine(), id);
    const st = getStructure(db, id)!;
    expect(st.weeks.map((w) => [w.label, w.hasMaterial, w.layers.length > 0])).toEqual([
      ["Week 1 · Introduction", true, true],
      ["Week 2 · The founding and the executive", true, true],
      ["Week 3 · Congress", true, true],
      ["Week 4 · Interbranch politics", true, true],
      ["Week 5 · The president in political time", true, true],
      ["Week 6 · Midterm exam, in class", false, false],
      ["Week 7 · Reading week, no class", false, false],
      ["Week 8 · War powers", false, false],
      ["Week 9 · Courts", false, false],
      ["Week 10 · Parties", false, false],
      ["Week 11 · Parties and polarization", false, false],
      ["Week 12 · Review", false, false],
    ]);
    // each week's layers come only from that week's own files
    for (const w of st.weeks.filter((x) => x.layers.length)) expect(new Set(w.layers.flatMap((l) => l.weeks))).toEqual(new Set([w.week]));
    // the syllabus, optional readings and exam material are never layers
    const used = db.select({ f: s.passages.fileId }).from(s.layerPassages).innerJoin(s.passages, eq(s.passages.id, s.layerPassages.passageId)).all().map((r) => r.f);
    const cats = new Set(db.select().from(s.files).all().filter((f) => used.includes(f.id)).map((f) => f.category));
    expect([...cats]).toEqual(["course"]);
  });

  it("attaches each optional reading to the layer it fits, and offers one no layer covers as an optional layer", async () => {
    await proposeStructure(db, cannedEngine(), id);
    const st = getStructure(db, id)!;
    const layers = st.weeks.flatMap((w) => w.layers);
    expect(layers.some((l) => l.extras.includes("Neustadt revisited.pdf"))).toBe(true);
    expect(st.looseOptional.map((o) => o.name)).toEqual(["Halberstam - The Best and the Brightest.pdf"]);
    const made = addOptionalLayer(db, id, st.looseOptional[0].fileId);
    const after = getStructure(db, id)!;
    expect(after.weeks.flatMap((w) => w.layers).find((l) => l.id === made)).toMatchObject({ optional: true, title: "Halberstam - The Best and the Brightest" });
    expect(after.looseOptional).toEqual([]);
    approvePlan(db, id);
    expect(getStructure(db, id)!.project.status).toBe("ready");
  });
});

describe("weeks", () => {
  it("a ten-week syllabus gives ten weeks, and the student can change the number", async () => {
    const id = await importCourse("TEN", await tenWeeks());
    expect(courseWeekCount(db, id)).toBe(10);
    expect(getCourseWeeks(db, id).weeks).toHaveLength(10);
    setWeekCount(db, id, 11);
    expect(getCourseWeeks(db, id).weeks).toHaveLength(11);
    expect(() => setWeekCount(db, id, 0)).toThrow();
  });

  it("when Claude's answer can't be used, the files stay unlabelled and Margin asks how many weeks", async () => {
    const id = createProject(db, { name: "Loose" });
    for (const f of await noStructure()) await addFile(db, id, { name: f.relPath.split("/").pop()!, relPath: `Loose/${f.relPath}`, bytes: f.bytes });
    // an answer of the right shape that leaves every file out, twice
    const engine = new FakeEngine({ json: (req: AiRequest) => (req.system.includes("find the SYLLABUS") ? { syllabus: [] } : { courseCode: null, weeks: [], files: [], missingReadings: [], notInSyllabus: [] }) });
    await analyzeProject(db, engine, id);
    expect(engine.calls).toHaveLength(3);
    expect(getPlanExtras(db, id)).toMatchObject({ unlabelled: 4, failed: expect.stringContaining("left the files unlabelled") });
    expect(courseWeekCount(db, id)).toBeNull();
    expect(asksWeeks(id)).toBe(true);
    setWeekCount(db, id, 12);
    expect(asksWeeks(id)).toBe(false);
    expect(getStructure(db, id)!.weekCount).toBe(12);
  });
});

describe("weeks that fit the course", () => {
  it("a ten-week syllabus: ten weeks with their titles, material in the first three", async () => {
    const id = await importCourse("TEN", await tenWeeks());
    await proposeStructure(db, cannedEngine(), id);
    const st = getStructure(db, id)!;
    expect(st.weeks.map((w) => w.label)).toEqual(["Week 1 · Topic 1", "Week 2 · Topic 2", "Week 3 · Topic 3", "Week 4 · Midterm 1", "Week 5 · Topic 5", "Week 6 · Topic 6", "Week 7 · Topic 7", "Week 8 · Midterm 2", "Week 9 · Topic 9", "Week 10 · Topic 10"]);
    expect(st.weeks.map((w) => w.layers.length > 0)).toEqual([true, true, true, false, false, false, false, false, false, false]);
  });

  it("the student renames a week's topic and moves a layer to another week, empty or not", async () => {
    const id = await importCourse("POL326", await pol326());
    await proposeStructure(db, cannedEngine(), id);
    let st = getStructure(db, id)!;
    renameWeek(db, st.weeks[2].id!, "Congress and the electoral connection");
    const moved = st.weeks[0].layers[0].id;
    moveLayerToWeek(db, moved, 8);
    st = getStructure(db, id)!;
    expect(st.weeks[2].label).toBe("Week 3 · Congress and the electoral connection");
    expect(st.weeks[7]).toMatchObject({ label: "Week 8 · War powers", layers: [expect.objectContaining({ id: moved })] });
    approvePlan(db, id);
    expect(getStructure(db, id)!.project.status).toBe("ready");
  });
});

describe("no duplicate layers", () => {
  it("knows when two titles are the same topic", () => {
    expect(sameTitle("The president and White House leadership", "The President and White House leadership")).toBe(true);
    expect(sameTitle("American culture, myth and Vietnam", "American myths and the road into Vietnam")).toBe(true);
    expect(sameTitle("Congress and interbranch politics", "The president and White House leadership")).toBe(false);
    expect(sameTitle("Federalist 10", "Federalist 51")).toBe(false);
    expect(duplicatePairs([{ title: "A" , texts: ["same words here", "more"] }, { title: "B", texts: ["same words here", "more"] }])).toEqual([[0, 1]]);
  });

  it("a plan that repeats a topic is retried with the reason, and merged if it still does", async () => {
    const id = await importCourse("POL326", await pol326());
    const engine = new FakeEngine({
      json: (req: AiRequest) => {
        if (!req.system.includes("CHAIN OF IDEAS")) return cannedJson(req);
        const count = [...req.prompt.matchAll(/^#(\d+) \|/gm)].length;
        const half = Math.floor(count / 2);
        return { layers: [
          { title: "Congress and interbranch politics", bigQuestion: "How do the branches bargain?", buildsOn: "", ranges: [{ from: 1, to: half }] },
          { title: "Congress and interbranch politics", bigQuestion: "How do the branches bargain again?", buildsOn: "", ranges: [{ from: half + 1, to: count }] },
        ] };
      },
    });
    await proposeStructure(db, engine, id);
    const calls = engine.calls.filter((c) => c.system.includes("CHAIN OF IDEAS"));
    expect(calls).toHaveLength(10); // two tries for each of the five weeks
    expect(calls.filter((c) => /same topic/.test(c.prompt))).toHaveLength(5);
    const st = getStructure(db, id)!;
    expect(st.weeks.filter((w) => w.layers.length).map((w) => w.layers.map((l) => l.title))).toEqual(Array(5).fill(["Congress and interbranch politics"])); // merged within each week
    const all = db.select().from(s.layerPassages).all().length;
    expect(all).toBeGreaterThan(0);
  });
});

describe("adding later weeks after the plan is approved", () => {
  it("POL326 lectures 6 and 7 arrive in weeks 8 and 9 as proposed layers; the weeks before are untouched until approved", async () => {
    const { commitFiles, placeNewPassages, getPending, approveProposals } = await import("@/lib/updates/service");
    const { pol326Later } = await import("../fixtures/courses");
    const id = await importCourse("POL326", await pol326());
    await proposeStructure(db, cannedEngine(), id);
    approvePlan(db, id);
    const layersOf = (st: ReturnType<typeof getStructure>) => st!.weeks.flatMap((w) => w.layers.map((l) => [w.week, l.id, l.title, l.position]));
    const before = layersOf(getStructure(db, id));

    const staged: { fileId: string }[] = [];
    for (const f of await pol326Later()) {
      const name = f.relPath.split("/").pop()!;
      // Claude reads the syllabus: the midterm and the reading week move lecture 6 to week 8 (labelling itself is tested in updates.test.ts)
      const week = f.relPath.startsWith("Lecture 06") ? 8 : 9;
      const row = await addFile(db, id, { name, relPath: f.relPath, bytes: f.bytes, label: { type: name.endsWith(".pptx") ? "lecture" : "reading", week, reason: `Lecture ${week - 2} falls in week ${week}.`, check: false } });
      staged.push({ fileId: row.id });
    }
    commitFiles(db, id, { staged, removals: [] });
    const placed = await placeNewPassages(db, cannedEngine(), id);
    expect(placed.proposed.length).toBeGreaterThan(0);
    expect(new Set(placed.proposed.map((p) => p.week))).toEqual(new Set(["Week 8 · War powers", "Week 9 · Courts"]));
    expect(placed.proposed.some((p) => p.fromLecture && p.weekNumber === 8)).toBe(true); // "Your Week 8 lecture covers something new"

    // nothing changes in the course until the student approves
    const waiting = getStructure(db, id)!;
    expect(layersOf(waiting)).toEqual(before);
    expect(waiting.weeks[7].layers).toEqual([]);

    approveProposals(db, id, getPending(db, id).proposed.map((p) => ({ layerId: p.id, action: "approve" as const })));
    const after = getStructure(db, id)!;
    expect(layersOf(after).filter(([w]) => (w as number) < 8)).toEqual(before);
    expect(after.weeks.slice(7, 9).map((w) => [w.label, w.status, w.layers.length > 0])).toEqual([
      ["Week 8 · War powers", "approved", true],
      ["Week 9 · Courts", "approved", true],
    ]);
    expect(after.project.status).toBe("ready");
  });

  it("a proposed new layer that repeats an existing topic is sent back", async () => {
    const { validatePlacement } = await import("@/lib/updates/service");
    const errors = validatePlacement({ placements: [{ layer: 0, title: "The President in political time", bigQuestion: "What is political time?", buildsOn: "", ranges: [{ from: 1, to: 2 }] }] }, 2, 1, ["The president and political time"]);
    expect(errors.join(" ")).toMatch(/same topic as layer 1/);
  });
});

describe("small fixes", () => {
  it("the course code and title are said once", async () => {
    const { courseTitle } = await import("@/lib/projects/title");
    expect(courseTitle("POL326", "POL326")).toBe("POL326");
    expect(courseTitle("POL326 The Presidency", "POL326")).toBe("POL326 The Presidency");
    expect(courseTitle("The Presidency", "POL326")).toBe("POL326 · The Presidency");
    expect(courseTitle("pol 326", "POL326")).toBe("pol 326");
    expect(courseTitle("The Presidency", null)).toBe("The Presidency");
  });

  it("optional readings reach the layer view verbatim and the chatbot labelled as optional", async () => {
    const { getLayer } = await import("@/lib/layers/service");
    const { formatPassages } = await import("@/lib/ai/prompts/shared");
    const id = await importCourse("POL326", await pol326());
    await proposeStructure(db, cannedEngine(), id);
    const layer = getStructure(db, id)!.weeks.flatMap((w) => w.layers).find((l) => l.extras.includes("Neustadt revisited.pdf"))!;
    const view = getLayer(db, layer.id)!;
    expect(view.optional.length).toBeGreaterThan(0);
    for (const q of view.optional) expect(db.select().from(s.passages).where(eq(s.passages.id, q.passageId)).get()!.text).toBe(q.text);
    expect(formatPassages([{ file: "x.pdf", page: 2, text: "t", optional: true }])).toBe("[x.pdf, p. 2] (optional reading)\nt");
  });
});
