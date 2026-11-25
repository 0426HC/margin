// @vitest-environment node
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cannedEngine, cannedJson } from "@/lib/ai/canned";
import { splitCitations } from "@/lib/ai/citations";
import type { AiRequest } from "@/lib/ai/engine";
import { FakeEngine } from "@/lib/ai/fake-engine";
import { classNotesPickSchema, lectureWritingSchema } from "@/lib/ai/schemas";
import { openDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { approvePlan, getStructure, proposeStructure, StructureError } from "@/lib/layers/service";
import { lectureFacts } from "@/lib/lecture/facts";
import { getLectureTab, refreshLayerAndLecture, writeLecture } from "@/lib/lecture/service";
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
    const power = facts.terms.find((t) => t.term === "power")!;
    expect(power.slides.map((x) => x.page)).toEqual([2, 3, 5]);
    expect(facts.terms.find((t) => t.term === "ambition")!.slides.map((x) => x.page)).toEqual([4, 5]);
    expect(facts.terms[0].slides.length).toBeGreaterThanOrEqual(facts.terms[facts.terms.length - 1].slides.length); // most slides first
  });

  it("finds phrases that come back on more than one slide, not ones that appear once", () => {
    const phrases = facts.repeated.map((r) => r.phrase);
    expect(phrases.some((p) => p.includes("ambition") && p.includes("counteract"))).toBe(true);
    expect(phrases).not.toContain("qualified veto");
    for (const r of facts.repeated) expect(r.slides.length).toBeGreaterThan(1);
  });

  it("copies the lines a slide marks as important and the lines that introduce an example, as written, with their slide", () => {
    expect(facts.flagged).toEqual([
      { file: "L.pptx", page: 2, text: "Important: the structure itself must resist" },
      { file: "L.pptx", page: 6, text: "Remember: a qualified veto also checks hasty law" },
    ]);
    expect(facts.examples).toEqual([{ file: "L.pptx", page: 3, text: "For example, judges are appointed, not elected" }]);
  });

  it("names the slides with the most on them", () => {
    expect(facts.longest[0]).toMatchObject({ page: 2, title: "The problem" });
    expect(facts.longest).toHaveLength(3);
  });

  it("says nothing when there is nothing to say", () => {
    const empty = lectureFacts([slide(1, "Title", "Hello")]);
    expect(empty).toMatchObject({ slides: 1, terms: [], repeated: [], flagged: [], examples: [] });
  });
});

describe("the Lecture tab of a layer", () => {
  let db: Db;
  let projectId: string;
  /** The layer that holds the lecture slides, and one that does not. */
  let withLecture: string;
  let without: string;

  beforeEach(async () => {
    db = openDb(":memory:").db;
    projectId = createProject(db, { name: "POL101" });
    const add = async (rel: string) => addFile(db, projectId, { name: path.basename(rel), relPath: rel, bytes: new Uint8Array(fs.readFileSync(path.join(COURSE, rel))) });
    await add("POL101 Syllabus F26.md");
    await add("Week 1 - Foundations/federalist-01.txt");
    await add("Week 3 - Checks and balances/federalist-51.md");
    await add("Week 3 - Checks and balances/Lecture 3 slides.pptx");
    await analyzeProject(db, cannedEngine(), projectId);
    await proposeStructure(db, cannedEngine(), projectId);
    approvePlan(db, projectId); // "Looks good"
    const layers = getStructure(db, projectId)!.weeks.flatMap((w) => w.layers);
    withLecture = layers.find((l) => getLectureTab(db, l.id).files.length)!.id;
    without = layers.find((l) => !getLectureTab(db, l.id).files.length)!.id;
  });

  it("knows which layers have lecture files, by the file's label", async () => {
    expect(getLectureTab(db, withLecture).files).toEqual(["Lecture 3 slides.pptx"]);
    expect(getLectureTab(db, without).files).toEqual([]);
    // the student can relabel a file: then the layer has none
    db.update(s.files).set({ role: "reading" }).where(eq(s.files.name, "Lecture 3 slides.pptx")).run();
    expect(getLectureTab(db, withLecture).files).toEqual([]);
  });

  it("with no lecture files it writes nothing and asks no model", async () => {
    const engine = cannedEngine();
    expect(() => writeLecture(db, engine, without)).toThrow(StructureError);
    expect(() => writeLecture(db, engine, without)).toThrow(/No lecture files for this layer yet/);
    expect(engine.calls).toHaveLength(0);
    expect(db.select().from(s.layerLecture).all()).toHaveLength(0);
  });

  it("writes it once, from the lecture slides only, counting by code, then reads it from the cache", async () => {
    const engine = cannedEngine();
    await writeLecture(db, engine, withLecture);
    const tab = getLectureTab(db, withLecture);
    expect(tab.content).not.toBeNull();
    expect(tab.content!.facts.files).toEqual([{ name: "Lecture 3 slides.pptx", slides: expect.any(Number) }]);
    expect(tab.content!.facts.slides).toBeGreaterThan(0);
    // the model is told the counted numbers, and the slide text is under "Lecture material"
    const lectureCall = engine.calls.find((c) => c.system.includes('write the "Lecture" tab'))!;
    expect(lectureCall.prompt).toContain("Counted by Margin");
    expect(lectureCall.prompt).toContain(`Slides in this layer: ${tab.content!.facts.slides}`);
    const slideSection = lectureCall.prompt.split("## Lecture material\n")[1].split("\n\n## ")[0];
    expect(slideSection).toContain("Lecture 3 slides.pptx");
    expect(slideSection).not.toContain("federalist-51.md");
    // Opus at medium effort for the writing, like Explained
    expect(lectureCall).toMatchObject({ model: "claude-opus-5-5", effort: "medium" });
    // once written, opening it again asks nothing
    const before = engine.calls.length;
    await writeLecture(db, engine, withLecture);
    expect(engine.calls).toHaveLength(before);
  });

  it("every citation in what it wrote points at a slide or a reading page that was sent", async () => {
    await writeLecture(db, cannedEngine(), withLecture);
    const w = getLectureTab(db, withLecture).content!.writing;
    const valid = new Set(db.select({ f: s.files.name, p: s.passages.page }).from(s.passages).innerJoin(s.files, eq(s.files.id, s.passages.fileId)).all().map((r) => `${r.f}#${r.p}`));
    let cites = 0;
    for (const b of w.blocks) {
      for (const text of b.type === "paragraph" ? [b.text] : b.type === "bullets" ? b.items : []) {
        for (const part of splitCitations(text)) if ("cite" in part) (cites++, expect(valid.has(`${part.cite.file}#${part.cite.page}`)).toBe(true));
      }
    }
    expect(cites).toBeGreaterThan(0);
  });

  it("a citation the model made up is asked about once, then stripped, so no link to a made-up slide is ever kept", async () => {
    const calls: string[] = [];
    const engine = new FakeEngine({
      json: (req: AiRequest) => {
        if (!req.system.includes('write the "Lecture" tab')) return cannedJson(req);
        calls.push(req.prompt);
        return { blocks: [{ type: "heading", text: "Where" }, { type: "paragraph", text: "A real claim. [Lecture 3 slides.pptx, p. 2] And an invented one. [Made up.pptx, p. 40]" }, { type: "bullets", items: ["Another. [Lecture 3 slides.pptx, p. 3]"] }] };
      },
    });
    await writeLecture(db, engine, withLecture);
    expect(calls).toHaveLength(2); // asked once more
    expect(calls[1]).toContain("Made up.pptx");
    const text = JSON.stringify(getLectureTab(db, withLecture).content!.writing);
    expect(text).not.toContain("Made up.pptx");
    expect(text).toContain("Lecture 3 slides.pptx, p. 2");
  });

  it("filters the student's own lecture notes to this layer, copied exactly, with a gentle note where they disagree", async () => {
    saveWeekNotes(db, projectId, 3, [
      { type: "heading", text: "Week 3" },
      { type: "bullet", text: "ambition -> counteracts ambition" },
      { type: "bullet", text: "the veto DIFFERS from what I thought" },
      { type: "paragraph", text: "lunch was off topic" },
    ]);
    const engine = cannedEngine();
    await writeLecture(db, engine, withLecture);
    const notes = getLectureTab(db, withLecture).content!.notes;
    expect(notes.weeksDrawn).toContain(3);
    const week3 = notes.weeks.find((w) => w.week === 3)!;
    expect(week3.lines).toContain("ambition -> counteracts ambition"); // the student's words, untouched
    expect(week3.lines).not.toContain("lunch was off topic");
    expect(notes.checks).toHaveLength(1);
    expect(notes.checks[0]).toMatch(/Worth a second look/);
    // the lines were chosen by the cheaper model
    const pick = engine.calls.find((c) => c.system.includes("class notes"))!;
    expect(pick.model).toBe("sonnet");
    expect(pick.system).toContain("not the professor's words");
  });

  it("a weeks' notes that don't exist are said to be missing, and the lecture notes are never sent anywhere else", async () => {
    const engine = cannedEngine();
    await writeLecture(db, engine, withLecture);
    const notes = getLectureTab(db, withLecture).content!.notes;
    expect(notes.weeks).toEqual([]);
    expect(notes.empty).toContain(3);
    // no notes at all: the notes model is never called
    expect(engine.calls.some((c) => c.system.includes("class notes"))).toBe(false);
    // and the layer's other prompts (Explained, review, chat) never carry lecture notes: only the lecture module reads them
    saveWeekNotes(db, projectId, 3, [{ type: "paragraph", text: "SECRETNOTE about ambition" }]);
    await writeLecture(db, engine, withLecture); // already written: only the notes are redone
    expect(engine.calls.filter((c) => c.prompt.includes("SECRETNOTE")).every((c) => c.system.includes("class notes"))).toBe(true);
  });

  it("when the lecture notes change, only the class-notes section is made again, by the cheap model", async () => {
    const engine = cannedEngine();
    await writeLecture(db, engine, withLecture);
    expect(getLectureTab(db, withLecture).notesStale).toBe(false);
    saveWeekNotes(db, projectId, 3, [{ type: "bullet", text: "a new note about ambition" }]);
    expect(getLectureTab(db, withLecture).notesStale).toBe(true);
    const opusBefore = engine.calls.filter((c) => c.model === "claude-opus-5-5").length;
    await writeLecture(db, engine, withLecture);
    expect(engine.calls.filter((c) => c.model === "claude-opus-5-5")).toHaveLength(opusBefore);
    expect(getLectureTab(db, withLecture).notesStale).toBe(false);
    expect(getLectureTab(db, withLecture).content!.notes.weeks[0].lines).toEqual(["a new note about ambition"]);
  });

  it("Refresh this layer writes Explained and the Lecture tab again and leaves the saved write-up alone", async () => {
    const engine = cannedEngine();
    const { writeLayerContent } = await import("@/lib/layers/service");
    await writeLayerContent(db, engine, withLecture);
    await writeLecture(db, engine, withLecture);
    db.insert(s.writebacks).values({ id: "w1", targetType: "layer", targetId: withLecture, text: "Mine." }).run();
    db.insert(s.noteSaves).values({ id: "n1", targetType: "layer", targetId: withLecture, writebackId: "w1", version: "own", text: "Mine." }).run();
    db.update(s.layers).set({ newMaterialAt: Date.now() }).where(eq(s.layers.id, withLecture)).run();
    const first = getLectureTab(db, withLecture).content!.writtenAt;
    await new Promise((r) => setTimeout(r, 5));
    await refreshLayerAndLecture(db, engine, withLecture);
    expect(getLectureTab(db, withLecture).content!.writtenAt).toBeGreaterThan(first);
    expect(getStructure(db, projectId)!.weeks.flatMap((w) => w.layers).find((l) => l.id === withLecture)!.newMaterial).toBe(false);
    expect(db.select().from(s.noteSaves).all()).toEqual([expect.objectContaining({ id: "n1", text: "Mine." })]);
    expect(db.select().from(s.writebacks).all()).toHaveLength(1);
  });

  it("deleting a layer's lecture files removes its stale Lecture tab on refresh", async () => {
    const engine = cannedEngine();
    const { writeLayerContent } = await import("@/lib/layers/service");
    await writeLayerContent(db, engine, withLecture);
    await writeLecture(db, engine, withLecture);
    db.update(s.files).set({ role: "reading" }).where(eq(s.files.name, "Lecture 3 slides.pptx")).run();
    await refreshLayerAndLecture(db, engine, withLecture);
    expect(db.select().from(s.layerLecture).all()).toHaveLength(0);
  });
});

describe("what the model may return", () => {
  const ok = { blocks: [{ type: "heading", text: "H" }, { type: "bullets", items: ["A claim. [L.pptx, p. 2]"] }, { type: "none", text: "Nothing on the slides is marked as important." }] };
  it("every paragraph and bullet needs a citation; only a plain 'nothing here' line may go without one", () => {
    expect(lectureWritingSchema.safeParse(ok).success).toBe(true);
    expect(lectureWritingSchema.safeParse({ blocks: [...ok.blocks.slice(0, 1), { type: "paragraph", text: "No citation here." }, ok.blocks[2]] }).success).toBe(false);
    expect(lectureWritingSchema.safeParse({ blocks: ok.blocks.slice(0, 2) }).success).toBe(false); // too short
  });
  it("the notes pick is numbers and gentle lines only", () => {
    expect(classNotesPickSchema.safeParse({ relevant: [1, 3], checks: [{ line: 3, text: "Your note says X, and slide 4 says Y. Worth a second look." }] }).success).toBe(true);
    expect(classNotesPickSchema.safeParse({ relevant: ["a note"], checks: [] }).success).toBe(false);
  });
});
