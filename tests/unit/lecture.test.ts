// @vitest-environment node
import { eq, sql } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cannedEngine, cannedText } from "@/lib/ai/canned";
import { splitCitations } from "@/lib/ai/citations";
import type { AiRequest } from "@/lib/ai/engine";
import { FakeEngine } from "@/lib/ai/fake-engine";
import { openDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { approvePlan, getStructure, proposeStructure } from "@/lib/layers/service";
import { lectureFacts } from "@/lib/lecture/facts";
import { notesSaved } from "@/lib/lecture/schedule";
import { getWeekLecture, nextLectureWeek, notesQuiet, weekHasLecture, writeWeekLecture } from "@/lib/lecture/service";
import { FROM_NOTES, lectureProblems, readLectureText } from "@/lib/lecture/text";
import type { LectureSlide } from "@/lib/lecture/types";
import { addFile, analyzeProject, createProject } from "@/lib/projects/service";
import { saveWeekNotes } from "@/lib/weeks/notes";

const COURSE = path.join("demo", "sample-course", "POL101 Federalist Seminar");
const slide = (page: number, heading: string | null, ...lines: string[]): LectureSlide => ({ file: "L.pptx", page, heading, lines });

beforeAll(() => {
  process.env.MARGIN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "margin-lec-"));
});

describe("counting a lecture", () => {
  const slides = [
    slide(1, "Checks and balances", "Why not just trust good people?"),
    slide(2, "The problem", "Power tends to gather in one place", "Written limits alone will not hold", "Important: the structure itself must resist"),
    slide(3, "Separate departments", "Each draws its power from a different source", "For example, judges are appointed, not elected"),
    slide(4, "Ambition against ambition", "Ambition must counteract ambition", "Give each officeholder a personal stake in the office"),
    slide(5, "Why divide the legislature?", "The legislature is the strongest branch of power", "Ambition must counteract ambition again, in two houses"),
    slide(6, "The veto", "Remember: a qualified veto also checks hasty law"),
  ];
  const facts = lectureFacts(slides);

  it("counts slides, once per slide however often a word repeats on it", () => {
    expect(facts.slides).toBe(6);
    expect(facts.files).toEqual([{ name: "L.pptx", slides: 6 }]);
    expect(facts.terms.find((t) => t.term === "power")!.slides.map((x) => x.page)).toEqual([2, 3, 5]);
    expect(facts.terms.find((t) => t.term === "ambition")!.slides.map((x) => x.page)).toEqual([4, 5]);
  });

  it("finds phrases that come back on more than one slide, and copies the lines the slides mark as important or as an example", () => {
    expect(facts.repeated.map((r) => r.phrase).some((p) => p.includes("ambition") && p.includes("counteract"))).toBe(true);
    expect(facts.flagged.map((f) => f.page)).toEqual([2, 6]);
    expect(facts.examples).toEqual([{ file: "L.pptx", page: 3, text: "For example, judges are appointed, not elected" }]);
  });
});

describe("the Lecture tab's text", () => {
  it("reads parts, topics, bullets and paragraphs, also while it is still arriving", () => {
    const text = "## Lecture 5\n\n### What it stressed\n- One. [A.pdf, p. 2]\n- Two (from your notes)\n\nA paragraph\nthat wraps. [A.pdf, p. 3]\n\n### Half a hea";
    expect(readLectureText(text)).toEqual([
      { type: "part", text: "Lecture 5" },
      { type: "topic", text: "What it stressed" },
      { type: "bullets", items: ["One. [A.pdf, p. 2]", "Two (from your notes)"] },
      { type: "paragraph", text: "A paragraph that wraps. [A.pdf, p. 3]" },
      { type: "topic", text: "Half a hea" },
    ]);
  });

  it("drops bold markup and flattens nested bullets, so no stray symbols show", () => {
    expect(readLectureText("**Exchange numbers.** The lecture says one thing.\n\n- Top\n  - nested")).toEqual([
      { type: "paragraph", text: "Exchange numbers. The lecture says one thing." },
      { type: "bullets", items: ["Top", "nested"] },
    ]);
  });

  it("finds citations to pages that weren't sent, and notes-section points with neither a citation nor the marker", () => {
    const sent = [{ file: "A.pdf", page: 2 }];
    expect(lectureProblems(`- Fine. [A.pdf, p. 2]\n- Mine. ${FROM_NOTES}\n- Made up. [A.pdf, p. 9]\n- Bare claim.`, sent, { notes: true })).toEqual({ invalid: ["[A.pdf, p. 9]"], unmarked: ["Bare claim."] });
    expect(lectureProblems("Bare claim.", sent, { notes: false }).unmarked).toEqual([]);
  });

  it("the quiet rule: the notes count as finished three minutes after the last save, or once the student left the page", () => {
    expect(notesQuiet(1_000, 1_000 + 179_000, 180_000)).toBe(false);
    expect(notesQuiet(1_000, 1_000 + 180_000, 180_000)).toBe(true);
    expect(notesQuiet(1_000, 2_000, 180_000, 1_500)).toBe(true); // left after the last save
    expect(notesQuiet(1_000, 2_000, 180_000, 500)).toBe(false); // left before editing again
  });
});

describe("the Lecture tab of a week", () => {
  let db: Db;
  let projectId: string;
  const notesCalls = (e: FakeEngine) => e.calls.filter((c) => c.task === "lecture-notes");
  const materialCalls = (e: FakeEngine) => e.calls.filter((c) => c.task === "lecture-material");
  /** The sample course (week 1 a reading, week 3 a reading and a lecture deck), plus any extra made-up files, imported and approved. */
  async function makeCourse(extra: { rel: string; text: string }[] = []) {
    db = openDb(":memory:").db;
    projectId = createProject(db, { name: "POL101" });
    const add = async (rel: string, bytes?: Uint8Array) => addFile(db, projectId, { name: path.basename(rel), relPath: rel, bytes: bytes ?? new Uint8Array(fs.readFileSync(path.join(COURSE, rel))) });
    await add("POL101 Syllabus F26.md");
    await add("Week 1 - Foundations/federalist-01.txt");
    await add("Week 3 - Checks and balances/federalist-51.md");
    await add("Week 3 - Checks and balances/Lecture 3 slides.pptx");
    for (const f of extra) await add(f.rel, new TextEncoder().encode(f.text));
    await analyzeProject(db, cannedEngine(), projectId);
    await proposeStructure(db, cannedEngine(), projectId);
    approvePlan(db, projectId);
  }

  beforeEach(() => makeCourse());
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.MARGIN_LECTURE_QUIET_S;
  });

  it("neither notes nor lecture material: no Lecture tab, and no model is asked", async () => {
    const engine = cannedEngine();
    expect(weekHasLecture(getWeekLecture(db, projectId, 1))).toBe(false);
    expect(getStructure(db, projectId)!.weeks.find((w) => w.week === 1)!.lecture).toBe(false);
    await writeWeekLecture(db, engine, projectId, 1);
    expect(engine.calls).toHaveLength(0);
    expect(db.select().from(s.weekLecture).all()).toHaveLength(0);
  });

  it("lecture material but no notes: the material section only, written once from the week's lecture files with counted numbers and checked citations", async () => {
    const engine = cannedEngine();
    const before = getWeekLecture(db, projectId, 3);
    expect(before).toMatchObject({ files: ["Lecture 3 slides.pptx"], hasNotes: false, notes: null, material: null });
    expect(getStructure(db, projectId)!.weeks.find((w) => w.week === 3)!.lecture).toBe(true);
    await writeWeekLecture(db, engine, projectId, 3);
    expect(notesCalls(engine)).toHaveLength(0);
    const [call] = materialCalls(engine);
    expect(call.model).toBe("claude-opus-5-5");
    expect(call.prompt).toContain("## Lecture file: Lecture 3 slides.pptx\nCounted by Margin:");
    expect(call.prompt.split("## Reading passages\n")[1]).toContain("federalist-51.md");
    const tab = getWeekLecture(db, projectId, 3);
    expect(tab.material).toMatchObject({ stale: false });
    for (const h of ["What it spent its time on", "What it stressed", "The examples it used", "Where it differs from the readings"]) expect(tab.material!.text).toContain(`### ${h}`);
    const sent = new Set([...call.prompt.matchAll(/^\[([^\]\n]+), p\. (\d+)\]/gm)].map((m) => `${m[1]}|${m[2]}`));
    const cites = splitCitations(tab.material!.text).flatMap((p) => ("cite" in p ? [`${p.cite.file}|${p.cite.page}`] : []));
    expect(cites.length).toBeGreaterThan(0);
    for (const c of cites) expect(sent.has(c)).toBe(true);
    // opened again: nothing is written again
    await writeWeekLecture(db, engine, projectId, 3);
    expect(materialCalls(engine)).toHaveLength(1);
  });

  it("notes and material: both sections; short notes are expanded from the week's files and pointed back to them; a point only in the notes is marked and never cited", async () => {
    saveWeekNotes(db, projectId, 3, [
      { type: "bullet", text: "ambition counteract ambition" },
      { type: "bullet", text: "prof's dog was in class lol" },
    ]);
    const engine = cannedEngine();
    await writeWeekLecture(db, engine, projectId, 3);
    expect(materialCalls(engine)).toHaveLength(1);
    const [call] = notesCalls(engine);
    expect(call.system).toContain("Expand only what the student wrote");
    expect(call.system).toContain(FROM_NOTES);
    expect(call.prompt).toContain("- ambition counteract ambition");
    // the passages sent are the ones the note lines are about, found by a word search over the week's files
    expect(call.prompt.split("## Passages from this week's readings and lecture material about these notes\n")[1]).toMatch(/ambition/i);
    const tab = getWeekLecture(db, projectId, 3);
    const lines = readLectureText(tab.notes!.text).flatMap((b) => (b.type === "bullets" ? b.items : []));
    const expanded = lines.find((l) => l.includes("ambition counteract ambition"))!;
    expect(splitCitations(expanded).some((p) => "cite" in p)).toBe(true);
    const own = lines.find((l) => l.includes("dog"))!;
    expect(own).toContain(FROM_NOTES);
    expect(splitCitations(own).some((p) => "cite" in p)).toBe(false);
    // the notes go only to the notes section, never to the material section
    expect(materialCalls(engine)[0].prompt).not.toContain("dog");
  });

  it("notes but no lecture material: the notes section only", async () => {
    saveWeekNotes(db, projectId, 1, [{ type: "bullet", text: "faction and the size of the republic" }]);
    const engine = cannedEngine();
    const before = getWeekLecture(db, projectId, 1);
    expect(before).toMatchObject({ files: [], hasNotes: true });
    expect(weekHasLecture(before)).toBe(true);
    expect(getStructure(db, projectId)!.weeks.find((w) => w.week === 1)!.lecture).toBe(true);
    await writeWeekLecture(db, engine, projectId, 1);
    expect(materialCalls(engine)).toHaveLength(0);
    expect(notesCalls(engine)).toHaveLength(1);
    expect(getWeekLecture(db, projectId, 1)).toMatchObject({ material: null, notes: { stale: false } });
  });

  it("two lectures in a week: the material section gives each its own part", async () => {
    const text = `# Lecture 3b: the senate\n\n${Array.from({ length: 40 }, (_, i) => `The senate checks the house on point ${i}. Important: a second chamber slows hasty law.`).join(" ")}\n`;
    await makeCourse([{ rel: "Week 3 - Checks and balances/Lecture 3b slides.md", text }]);
    const engine = cannedEngine();
    await writeWeekLecture(db, engine, projectId, 3);
    expect(materialCalls(engine)[0].prompt.match(/^## Lecture file: /gm)).toHaveLength(2);
    expect(materialCalls(engine)[0].system).toContain("give each lecture its own part");
    const parts = readLectureText(getWeekLecture(db, projectId, 3).material!.text).filter((b) => b.type === "part");
    expect(parts.map((p) => p.text)).toEqual(["Lecture 3 slides", "Lecture 3b slides"]);
  });

  it("a citation the model made up, or a notes point with no source, is sent back once; a bad citation still there is stripped", async () => {
    saveWeekNotes(db, projectId, 3, [{ type: "bullet", text: "ambition" }]);
    let n = 0;
    const engine = new FakeEngine({
      text: (req: AiRequest) => {
        if (req.task !== "lecture-notes") return cannedText(req);
        n++;
        const real = req.prompt.match(/^\[[^\]\n]+, p\. \d+\]/m)![0]; // a page that was sent
        return n === 1 ? "- Ambition counteracts ambition. [Made up.pdf, p. 4]\n- A bare claim." : `- Ambition counteracts ambition. [Made up.pdf, p. 4] ${real}`;
      },
    });
    await writeWeekLecture(db, engine, projectId, 3);
    const calls = notesCalls(engine);
    expect(calls).toHaveLength(2);
    expect(calls[1].prompt).toContain("[Made up.pdf, p. 4]");
    expect(calls[1].prompt).toContain('"A bare claim."');
    const text = getWeekLecture(db, projectId, 3).notes!.text;
    expect(text).not.toContain("Made up.pdf");
    expect(splitCitations(text).filter((p) => "cite" in p)).toHaveLength(1);
  });

  it("regenerates the notes section only after editing stops: three quiet minutes, or leaving the page", async () => {
    saveWeekNotes(db, projectId, 3, [{ type: "bullet", text: "ambition" }]);
    const engine = cannedEngine();
    await writeWeekLecture(db, engine, projectId, 3);
    expect(notesCalls(engine)).toHaveLength(1);

    vi.useFakeTimers();
    // typing: every autosave starts the clock again
    for (let i = 0; i < 5; i++) {
      saveWeekNotes(db, projectId, 3, [{ type: "bullet", text: `ambition, edit ${i}` }]);
      notesSaved(db, engine, projectId, 3);
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(notesCalls(engine)).toHaveLength(1);
    expect(getWeekLecture(db, projectId, 3).notes!.stale).toBe(true); // the old version stays, marked out of date
    // and the background leaves it alone while the student is editing
    expect(nextLectureWeek(db, { missing: true })).toBeNull();
    await vi.advanceTimersByTimeAsync(180_000);
    await vi.waitFor(() => expect(notesCalls(engine)).toHaveLength(2));
    await vi.waitFor(() => expect(getWeekLecture(db, projectId, 3).notes!.stale).toBe(false));
    expect(notesCalls(engine)[1].prompt).toContain("ambition, edit 4");
    expect(materialCalls(engine)).toHaveLength(1); // the material section didn't change

    // leaving the Lecture notes page writes it at once
    saveWeekNotes(db, projectId, 3, [{ type: "bullet", text: "ambition, last edit" }]);
    notesSaved(db, engine, projectId, 3, { left: true });
    await vi.waitFor(() => expect(notesCalls(engine)).toHaveLength(3));
  });

  it("the background writes a section whose files changed, and the notes once they are quiet; emptied notes take their section away", async () => {
    saveWeekNotes(db, projectId, 3, [{ type: "bullet", text: "ambition" }]);
    const engine = cannedEngine();
    await writeWeekLecture(db, engine, projectId, 3);
    expect(nextLectureWeek(db, { missing: false })).toBeNull();
    // the week's lecture file is relabelled as a reading: the material section is gone, the notes section is out of date
    db.update(s.files).set({ role: "reading", type: "reading" }).where(eq(s.files.name, "Lecture 3 slides.pptx")).run();
    process.env.MARGIN_LECTURE_QUIET_S = "0";
    expect(nextLectureWeek(db, { missing: false })).toEqual({ projectId, week: 3 });
    await writeWeekLecture(db, engine, projectId, 3, { quietOnly: true });
    expect(getWeekLecture(db, projectId, 3)).toMatchObject({ files: [], material: null, notes: { stale: false } });
    expect(db.select().from(s.weekLecture).all().map((r) => r.part)).toEqual(["notes"]);
    saveWeekNotes(db, projectId, 3, []);
    await writeWeekLecture(db, engine, projectId, 3);
    expect(db.select().from(s.weekLecture).all()).toHaveLength(0);
  });

  it("the same tab for every layer of a week: it is stored once per week", async () => {
    const engine = cannedEngine();
    await writeWeekLecture(db, engine, projectId, 3);
    const rows = db.select().from(s.weekLecture).all();
    expect(rows.map((r) => [r.week, r.part])).toEqual([[3, "material"]]);
    // the old per-layer table is gone
    expect(db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table' and name = 'layer_lecture'`)).toHaveLength(0);
  });
});
