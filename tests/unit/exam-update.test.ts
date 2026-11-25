import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { changedPart, summaryChanges } from "@/lib/exam/changes";
import type { ExamSummary } from "@/lib/exam/types";

const demo = JSON.parse(fs.readFileSync(path.join(process.cwd(), "demo/exam/summary.json"), "utf8")) as ExamSummary;

describe("What changes (Update exam details)", () => {
  it("shows only the changed part of an instruction: the brief's own example", () => {
    const next = { ...demo, sections: demo.sections.map((s) => (s.name === "Part II" ? { ...s, instructions: "One essay, choice of three questions." } : s)) };
    expect(summaryChanges(demo, next)).toEqual([{ label: "Part II", from: "choice of two questions", to: "choice of three questions" }]);
  });

  it("no changes, no lines", () => {
    expect(summaryChanges(demo, structuredClone(demo))).toEqual([]);
  });

  it("lists every kind of change in the order of the form", () => {
    const next: ExamSummary = {
      ...demo,
      date: "December 16",
      lengthMinutes: 150,
      sections: [{ ...demo.sections[0], count: 6 }, demo.sections[1], { name: "Part III", format: "multiple_choice", count: 10, marksEach: 1, instructions: "" }],
      weeks: [1, 2],
      terms: [...demo.terms.slice(1), "Federalism"],
    };
    expect(summaryChanges(demo, next)).toEqual([
      { label: "Date", from: "December 14", to: "December 16" },
      { label: "Length", from: "2 hours", to: "150 minutes" },
      { label: "Part I, questions", from: "5 questions", to: "6 questions" },
      { label: "New section", from: null, to: "Part III: 10 multiple choice questions" },
      { label: "Weeks it covers", from: "Weeks 1, 2, 3", to: "Weeks 1, 2" },
      { label: "Terms", from: null, to: "Federalism" },
      { label: "Terms", from: "Faction", to: null },
    ]);
  });

  it("changedPart keeps whole words around the change", () => {
    expect(changedPart("Answer two of four questions.", "Answer three of four questions.")).toEqual(["Answer two of four questions", "Answer three of four questions"]);
    expect(changedPart("Closed book. Bring a pen.", "Closed book. Bring a pencil.")).toEqual(["Bring a pen", "Bring a pencil"]);
  });
});

// ---- the service: propose, confirm, versions and old-format attempts (fake engine, in-memory database) ----
import { eq } from "drizzle-orm";
import os from "node:os";
import { beforeAll, beforeEach } from "vitest";
import { cannedEngine } from "@/lib/ai/canned";
import { openDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { applyExamUpdate, createExam, deleteExam, ensureExams, generateSet, getExamView, handIn, listExams, proposeExamUpdate, readExamSummary, saveExamSummary, startAttempt } from "@/lib/exam/service";
import { approvePlan, proposeStructure } from "@/lib/layers/service";
import { addFile, analyzeProject, createProject } from "@/lib/projects/service";

const COURSE = path.join("demo", "sample-course", "POL101 Federalist Seminar");
const enc = (t: string) => new TextEncoder().encode(t);

describe("updating an exam's details", () => {
  let db: Db;
  let id: string;
  let examId: string;
  const engine = cannedEngine();

  beforeAll(() => {
    process.env.MARGIN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "margin-exam-update-"));
  });
  beforeEach(async () => {
    db = openDb(":memory:").db;
    id = createProject(db, { name: "POL101" });
    const add = async (rel: string) => addFile(db, id, { name: path.basename(rel), relPath: rel, bytes: new Uint8Array(fs.readFileSync(path.join(COURSE, rel))) });
    await add("POL101 Syllabus F26.md");
    await add("Week 1 - Foundations/federalist-01.txt");
    await add("Week 2 - Faction/federalist-10-reader.pdf");
    await add("Week 3 - Checks and balances/federalist-51.md");
    await add("Week 3 - Checks and balances/Lecture 3 slides.pptx");
    await analyzeProject(db, cannedEngine(), id);
    await proposeStructure(db, engine, id);
    approvePlan(db, id); // "Looks good"
    const sheet = (await addFile(db, id, { name: "Final exam instructions.txt", relPath: "Final exam instructions.txt", bytes: enc("Final exam instructions\n\nTime allowed: 120 minutes. Essay."), label: { type: "exam", week: null, reason: null, check: false } })).id;
    examId = createExam(db, id, sheet);
    await readExamSummary(db, engine, examId);
    saveExamSummary(db, examId, demo, true);
  });

  it("proposes changes from a note, without saving anything", async () => {
    const proposed = await proposeExamUpdate(db, engine, examId, { note: "Prof said Part II will have three essay choices", sheet: null });
    expect(summaryChanges(demo, proposed)).toEqual([{ label: "Part II", from: "choice of two questions", to: "choice of three questions" }]);
    expect(getExamView(db, examId)).toMatchObject({ version: 1, summary: { sections: demo.sections } });
    expect(engine.calls.filter((c) => c.system.includes("You update the details of a student's exam")).at(-1)).toMatchObject({ model: "claude-opus-5-5" });
    await expect(proposeExamUpdate(db, engine, examId, { note: "  ", sheet: null })).rejects.toThrow(/Add an updated sheet or write what changed/);
  });

  it("confirming saves a new version; past attempts stay linked to theirs and are labelled old format; new sets use the new version", async () => {
    const set = await generateSet(db, engine, examId);
    const a = startAttempt(db, set.id, "none");
    await handIn(db, engine, a.id, {});
    expect(getExamView(db, examId)!.attempts.map((x) => [x.version, x.oldFormat])).toEqual([[1, false]]);

    const next = await proposeExamUpdate(db, engine, examId, { note: "three essay choices", sheet: null });
    expect(applyExamUpdate(db, examId, next, { note: "three essay choices" })).toMatchObject({ version: 2 });

    const v = getExamView(db, examId)!;
    expect(v.version).toBe(2);
    expect(v.summary!.sections[1].instructions).toBe("One essay, choice of three questions.");
    expect(v.attempts.map((x) => [x.id, x.version, x.oldFormat])).toEqual([[a.id, 1, true]]);
    expect(v.set).toBeNull(); // the old-format set is not offered again
    const versions = db.select().from(s.examVersions).where(eq(s.examVersions.examId, examId)).all();
    expect(versions.map((x) => [x.number, x.summary.sections[1].instructions, x.note])).toEqual([
      [1, "One essay, choice of two questions.", null],
      [2, "One essay, choice of three questions.", "three essay choices"],
    ]);

    const fresh = await generateSet(db, engine, examId);
    expect(db.select().from(s.examSets).where(eq(s.examSets.id, fresh.id)).get()!.version).toBe(2);
    expect(getExamView(db, examId)!.set!.id).toBe(fresh.id);
  });

  it("an updated sheet belongs to its exam (not a new exam) and is deleted with it", async () => {
    const updated = (await addFile(db, id, { name: "Final exam instructions v2.txt", relPath: "Final exam instructions v2.txt", bytes: enc("Final exam, updated. Part II: choice of three questions."), label: { type: "exam", week: null, reason: null, check: false } })).id;
    applyExamUpdate(db, examId, demo, { sheetFileId: updated });
    ensureExams(db, id);
    expect(listExams(db, id)).toHaveLength(1);
    expect(getExamView(db, examId)!.sheetName).toBe("Final exam instructions v2.txt");
    deleteExam(db, examId);
    expect(db.select().from(s.files).where(eq(s.files.role, "exam")).all()).toEqual([]);
    expect(db.select().from(s.examVersions).all()).toEqual([]);
  });

  it("refuses details that don't fit the form, and changes nothing", () => {
    expect(() => applyExamUpdate(db, examId, { ...demo, sections: [] })).toThrow(/can't be saved/);
    expect(getExamView(db, examId)!.version).toBe(1);
  });
});
