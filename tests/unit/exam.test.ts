// @vitest-environment node
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cannedEngine, cannedJson } from "@/lib/ai/canned";
import type { AiRequest } from "@/lib/ai/engine";
import { FakeEngine } from "@/lib/ai/fake-engine";
import { examFeedbackSchema, examQuestionsSchema, examSummarySchema } from "@/lib/ai/schemas";
import { openDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { checkQuestions, markChoice, MAX_QUESTIONS, planQuestions, tally, tooSimilar } from "@/lib/exam/plan";
import { attachMaterial, createExam, deleteExam, ensureExams, generateSet, getExamView, handIn, listExams, readExamSummary, removeMaterial, saveAnswers, saveExamSummary, startAttempt } from "@/lib/exam/service";
import { weakLayers } from "@/lib/exam/sources";
import type { ExamQuestion, ExamSummary } from "@/lib/exam/types";
import { saveWriteback, submitWriteback } from "@/lib/layers/writeback";
import { deleteProject } from "@/lib/projects/delete";
import { addFile, analyzeProject, createProject } from "@/lib/projects/service";
import { saveWeekNotes } from "@/lib/weeks/notes";
import { approvePlan, getStructure, proposeStructure } from "@/lib/layers/service";

const COURSE = path.join("demo", "sample-course", "POL101 Federalist Seminar");
const enc = (t: string) => new TextEncoder().encode(t);
const summary = (over: Partial<ExamSummary> = {}): ExamSummary => ({
  title: "Midterm exam", date: null, lengthMinutes: 90, totalMarks: null,
  sections: [{ name: "Section A", format: "multiple_choice", count: 3, marksEach: 2, instructions: "" }, { name: "Section B", format: "essay", count: 1, marksEach: 10, instructions: "" }],
  weeks: [], topics: [], markingGuide: "Marks are awarded for use of the readings.", terms: [], sampleQuestions: [], ...over,
});

beforeAll(() => {
  process.env.MARGIN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "margin-exam-"));
});

describe("planning a set", () => {
  it("copies the sheet's sections and counts, with the real time limit", () => {
    const p = planQuestions(summary());
    expect(p.rows.map((r) => [r.format, r.count, r.marksEach])).toEqual([["multiple_choice", 3, 2], ["essay", 1, 10]]);
    expect([p.planned, p.built, p.minutes]).toEqual([4, 4, 90]);
  });
  it("shortens a long exam proportionally, keeps every section, and scales the time", () => {
    const p = planQuestions(summary({ lengthMinutes: 120, sections: [{ name: "A", format: "multiple_choice", count: 50, marksEach: 1, instructions: "" }, { name: "B", format: "short_answer", count: 10, marksEach: 5, instructions: "" }, { name: "C", format: "essay", count: 2, marksEach: 20, instructions: "" }] }));
    expect(p.planned).toBe(62);
    expect(p.built).toBeLessThanOrEqual(MAX_QUESTIONS);
    expect(p.rows.every((r) => r.count >= 1)).toBe(true);
    expect(p.minutes).toBeLessThan(120);
    expect(p.minutes).toBeGreaterThan(30);
  });
  it("has no time limit when the sheet gives none, and defaults the marks by format", () => {
    const p = planQuestions(summary({ lengthMinutes: null, sections: [{ name: "A", format: "problem", count: 2, marksEach: null, instructions: "" }] }));
    expect(p.minutes).toBeNull();
    expect(p.rows[0].marksEach).toBeGreaterThan(0);
  });
  it("tells a repeated question from a new one", () => {
    expect(tooSimilar("Explain the passage that begins “the great object is”?", "Explain the passage that begins “the great object is”")).toBe(true);
    expect(tooSimilar("Why does Madison fear faction?", "How does the veto check hasty legislation?")).toBe(false);
  });
});

describe("checking what the model wrote", () => {
  const plan = planQuestions(summary());
  const sent = [{ file: "a.txt", page: 1 }, { file: "b.txt", page: 2 }];
  const q = (section: number, over: object = {}) => ({ section, prompt: "A real question about the passage?", keyPoints: ["a point"], builtFrom: [{ kind: "reading" as const, label: "your reading", cite: "[a.txt, p. 1]" }], ...over });
  const mc = (over = {}) => q(1, { options: ["a", "b", "c", "d"], correct: 1, ...over });
  const good = { questions: [mc(), mc({ prompt: "Another multiple choice question?" }), mc({ prompt: "A third multiple choice question?" }), q(2, { prompt: "Discuss the argument of the passage." })] };

  it("accepts a valid set and numbers it", () => {
    const r = checkQuestions(good, plan, sent, []);
    expect(r.errors).toEqual([]);
    expect(r.questions.map((x) => x.id)).toEqual(["q1", "q2", "q3", "q4"]);
    expect(r.questions[0]).toMatchObject({ marks: 2, correct: 1, format: "multiple_choice" });
    expect(r.questions[3]).toMatchObject({ marks: 10, format: "essay" });
  });
  it("needs the right number per section, options and a right answer for multiple choice, and none for the rest", () => {
    expect(checkQuestions({ questions: good.questions.slice(0, 3) }, plan, sent, []).errors.join(" ")).toMatch(/Section 2 needs exactly 1/);
    expect(checkQuestions({ questions: [mc({ correct: 9 }), ...good.questions.slice(1)] }, plan, sent, []).errors.join(" ")).toMatch(/needs options and the index/);
    expect(checkQuestions({ questions: [...good.questions.slice(0, 3), q(2, { options: ["x", "y"] })] }, plan, sent, []).errors.join(" ")).toMatch(/must not have options/);
  });
  it("drops a citation that was not sent, and refuses a question left with none", () => {
    const fake = q(2, { builtFrom: [{ kind: "reading", label: "x", cite: "[made-up.pdf, p. 3]" }] });
    expect(checkQuestions({ questions: [...good.questions.slice(0, 3), fake] }, plan, sent, []).errors.join(" ")).toMatch(/cites nothing that was in the sources/);
    const mixed = q(2, { builtFrom: [{ kind: "reading", label: "x", cite: "[made-up.pdf, p. 3]" }, { kind: "reading", label: "y", cite: "[b.txt, p. 2]" }] });
    const r = checkQuestions({ questions: [...good.questions.slice(0, 3), mixed] }, plan, sent, []);
    expect(r.errors).toEqual([]);
    expect(r.questions[3].builtFrom.map((o) => o.cite)).toEqual(["[b.txt, p. 2]"]);
  });
  it("refuses a question that repeats an earlier one", () => {
    expect(checkQuestions(good, plan, sent, ["A real question about the passage?"]).errors.join(" ")).toMatch(/repeats an earlier question/);
  });
});

describe("marking by code", () => {
  const mcq: ExamQuestion = { id: "q1", section: 1, format: "multiple_choice", prompt: "p", marks: 2, options: ["x", "y", "z"], correct: 2, keyPoints: [], builtFrom: [] };
  it("marks the right option, the wrong one and a skip", () => {
    expect(markChoice(mcq, "2")).toMatchObject({ marksAwarded: 2, status: "marked", by: "code" });
    expect(markChoice(mcq, "0")).toMatchObject({ marksAwarded: 0, status: "marked", fixes: ["The right answer is “z”."] });
    expect(markChoice(mcq, undefined)).toMatchObject({ marksAwarded: 0, status: "skipped" });
    expect(markChoice(mcq, "")).toMatchObject({ status: "skipped" });
  });
  it("adds it up", () => {
    const t = tally([markChoice(mcq, "2"), { id: "q2", status: "skipped", marksAwarded: 0, marks: 5, by: "examiner", strengths: "", fixes: [] }], [mcq, { ...mcq, id: "q2", format: "essay", marks: 5 }]);
    expect(t).toMatchObject({ earned: 2, total: 7, answered: 1, skipped: 1 });
  });
});

describe("schemas", () => {
  it("a summary needs a section and a plain title; marks and weeks have sane bounds", () => {
    expect(examSummarySchema.safeParse(summary()).success).toBe(true);
    expect(examSummarySchema.safeParse({ ...summary(), sections: [] }).success).toBe(false);
    expect(examSummarySchema.safeParse({ ...summary(), weeks: [0] }).success).toBe(false);
    expect(examQuestionsSchema.safeParse({ questions: [{ section: 1, prompt: "short", keyPoints: [], builtFrom: [] }] }).success).toBe(false);
    expect(examFeedbackSchema.safeParse({ results: [{ id: "q1", marksAwarded: 3, strengths: "", fixes: [] }] }).success).toBe(true);
  });
});

describe("the exam room for a course", () => {
  let db: Db;
  let id: string;
  let sheet: string;
  const SHEET = "Midterm exam instructions\n\nTime allowed: 90 minutes. Section A: multiple choice. Section B: essay. Covers weeks 1 to 3. Marking guide: marks are awarded for use of the readings.";
  const asks = (e: FakeEngine, needle: string) => e.calls.filter((c) => c.system.includes(needle));

  beforeEach(async () => {
    db = openDb(":memory:").db;
    id = createProject(db, { name: "POL101" });
    const add = async (rel: string) => addFile(db, id, { name: path.basename(rel), relPath: rel, bytes: new Uint8Array(fs.readFileSync(path.join(COURSE, rel))) });
    await add("POL101 Syllabus F26.md");
    await add("Week 1 - Foundations/federalist-01.txt");
    await add("Week 3 - Checks and balances/federalist-51.md");
    await add("Week 3 - Checks and balances/Lecture 3 slides.pptx");
    await analyzeProject(db, cannedEngine(), id);
    await proposeStructure(db, cannedEngine(), id);
    approvePlan(db, id); // "Looks good"
    sheet = (await addFile(db, id, { name: "Midterm exam instructions.txt", relPath: "Midterm exam instructions.txt", bytes: enc(SHEET), label: { type: "exam", week: null, reason: null, check: false } })).id;
  });

  it("every exam sheet gets an exam of its own, once, named Midterm or Final; an attached past exam is not a new exam", async () => {
    ensureExams(db, id);
    ensureExams(db, id);
    expect(listExams(db, id).map((e) => [e.title, e.kind, e.status])).toEqual([["Midterm", "midterm", "unread"]]);
    const examId = listExams(db, id)[0].id;
    const past = (await addFile(db, id, { name: "Past midterm 2024.txt", relPath: "Past midterm 2024.txt", bytes: enc("Past exam. Q1 Explain faction."), label: { type: "exam", week: null, reason: null, check: false } })).id;
    attachMaterial(db, examId, past);
    expect(listExams(db, id)).toHaveLength(1);
    const second = (await addFile(db, id, { name: "Midterm retake sheet.txt", relPath: "Midterm retake sheet.txt", bytes: enc("Midterm exam instructions. Time allowed: 60 minutes."), label: { type: "exam", week: null, reason: null, check: false } })).id;
    ensureExams(db, id);
    expect(listExams(db, id).map((e) => e.title)).toEqual(["Midterm", "Midterm 2"]);
    void second;
  });

  it("reads the sheet into a summary the student must check; nothing is generated before they confirm", async () => {
    const examId = createExam(db, id, sheet);
    const engine = cannedEngine();
    expect(() => generateSet(db, engine, examId)).toThrow(/Read the exam sheet first/);
    const read = await readExamSummary(db, engine, examId);
    expect(read).toMatchObject({ lengthMinutes: 90, weeks: [1, 2, 3] });
    expect(read.sections.map((x) => x.format)).toEqual(["multiple_choice", "essay"]);
    expect(asks(engine, "You read an exam instruction sheet")[0]).toMatchObject({ model: "claude-opus-5-5", effort: "medium" });
    expect(getExamView(db, examId)).toMatchObject({ confirmed: false });
    expect(() => generateSet(db, engine, examId)).toThrow(/Check the summary of the sheet first/);
    expect(asks(engine, "You write a practice exam")).toHaveLength(0);
    // the student edits it and says it looks right
    saveExamSummary(db, examId, { ...read, lengthMinutes: 60, topics: ["faction"] }, true);
    expect(getExamView(db, examId)).toMatchObject({ confirmed: true, summary: { lengthMinutes: 60, topics: ["faction"] } });
    expect(() => saveExamSummary(db, examId, { ...read, sections: [] }, true)).toThrow(/can't be saved/);
  });

  async function ready(engine = cannedEngine(), edit: Partial<ExamSummary> = {}) {
    const examId = createExam(db, id, sheet);
    const read = await readExamSummary(db, engine, examId);
    saveExamSummary(db, examId, { ...read, ...edit }, true);
    return { examId, engine };
  }

  it("writes a set in the sheet's format, each question built from the sources with a citation that was sent", async () => {
    const { examId, engine } = await ready();
    const set = await generateSet(db, engine, examId);
    expect(set.questions).toHaveLength(4);
    expect(set.questions.map((q) => q.format)).toEqual(["multiple_choice", "multiple_choice", "multiple_choice", "essay"]);
    expect(set.minutes).toBe(90);
    for (const q of set.questions) {
      expect(q.builtFrom.length).toBeGreaterThan(0);
      for (const o of q.builtFrom) expect(o.cite).toMatch(/^\[[^\]]+, p\. \d+\]$/);
    }
    for (const q of set.questions.filter((x) => x.format === "multiple_choice")) expect(q.options).toHaveLength(4);
    const call = asks(engine, "You write a practice exam")[0];
    expect(call).toMatchObject({ model: "claude-opus-5-5", effort: "medium" });
    expect(call.system).toContain("not predictions of the real exam");
    // the sources are the sheet, the covered readings and what the lecture stressed, and nothing from the lecture notes
    expect(call.prompt).toContain("Midterm exam instructions.txt");
    expect(call.prompt).toContain("What the lectures stressed (counted by Margin)");
    expect(call.prompt).toContain("Slides or pages:");
  });

  it("lecture notes are never sent to any exam prompt", async () => {
    saveWeekNotes(db, id, 3, [{ type: "paragraph", text: "SECRETWEEKNOTE about ambition" }]);
    const { examId, engine } = await ready();
    await generateSet(db, engine, examId);
    expect(engine.calls.some((c) => c.prompt.includes("SECRETWEEKNOTE"))).toBe(false);
  });

  it("only passages of the covered weeks are used", async () => {
    const { examId, engine } = await ready(cannedEngine(), { weeks: [1] });
    await generateSet(db, engine, examId);
    const prompt = asks(engine, "You write a practice exam")[0].prompt;
    expect(prompt).toContain("federalist-01.txt");
    expect(prompt).not.toContain("federalist-51.md");
    expect(prompt).not.toContain("Lecture 3 slides.pptx");
  });

  it("uploaded past exams are sources too, and can be removed for good", async () => {
    const { examId, engine } = await ready();
    const past = (await addFile(db, id, { name: "Past midterm 2024.txt", relPath: "Past midterm 2024.txt", bytes: enc("Past exam. Question 1: Explain why Madison fears faction. Question 2: Discuss checks."), label: { type: "exam", week: null, reason: null, check: false } })).id;
    attachMaterial(db, examId, past);
    await generateSet(db, engine, examId);
    expect(asks(engine, "You write a practice exam")[0].prompt).toContain("Past midterm 2024.txt");
    expect(getExamView(db, examId)!.materials.map((m) => m.name)).toEqual(["Past midterm 2024.txt"]);
    removeMaterial(db, examId, past);
    expect(getExamView(db, examId)!.materials).toEqual([]);
    expect(db.select().from(s.files).where(eq(s.files.id, past)).get()).toBeUndefined();
  });

  it("New questions: a fresh set that avoids the earlier questions and leans toward weaker layers", async () => {
    const { examId, engine } = await ready();
    const first = await generateSet(db, engine, examId);
    // one layer is strong: written back and saved
    const layers = getStructure(db, id)!.weeks.flatMap((w) => w.layers);
    const r = await submitWriteback(db, cannedEngine(), layers[0].id, "My own words about the first layer, plainly said.");
    saveWriteback(db, layers[0].id, r.writebackId, "own");
    expect(weakLayers(db, id).find((w) => w.id === layers[0].id)?.reason).toBe("the last review asked for more"); // saved, but the review wanted more
    const r2 = await submitWriteback(db, cannedEngine(), layers[0].id, "My own words about the first layer, said again, more fully and plainly.");
    saveWriteback(db, layers[0].id, r2.writebackId, "own");
    expect(weakLayers(db, id).map((w) => w.id)).not.toContain(layers[0].id);
    expect(weakLayers(db, id).length).toBe(layers.length - 1);
    const second = await generateSet(db, engine, examId);
    expect(second.number).toBe(2);
    expect(second.id).not.toBe(first.id);
    const prompt = asks(engine, "You write a practice exam").at(-1)!.prompt;
    expect(prompt).toContain("Questions to avoid repeating");
    expect(prompt).toContain("Weaker layers: lean toward these");
    expect(prompt).not.toMatch(new RegExp(`- ${layers[0].title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(`)); // the strong layer is not listed as weak
    const same = second.questions.filter((q) => first.questions.some((f) => tooSimilar(f.prompt, q.prompt)));
    expect(same).toEqual([]);
  });

  it("an invalid set is asked for once more with the reasons, then refused rather than shown", async () => {
    const { examId } = await ready();
    const seen: string[] = [];
    const bad = new FakeEngine({ json: (req: AiRequest) => (req.system.includes("You write a practice exam") ? (seen.push(req.prompt), { questions: [{ section: 1, prompt: "Only one question here?", keyPoints: [], builtFrom: [{ kind: "reading", label: "x", cite: "[nowhere.pdf, p. 1]" }] }] }) : cannedJson(req)) });
    await expect(generateSet(db, bad, examId)).rejects.toThrow(/couldn't get a valid practice exam/);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toContain("Your last answer was rejected");
    expect(db.select().from(s.examSets).all()).toHaveLength(0);
  });

  describe("sitting and handing in", () => {
    async function sit(timer: "real" | "none" = "none") {
      const { examId, engine } = await ready();
      const set = await generateSet(db, engine, examId);
      return { examId, engine, set, attempt: startAttempt(db, set.id, timer) };
    }

    it("the real time limit sets a deadline from the sheet; no timer sets none", async () => {
      const a = await sit("real");
      expect(a.attempt.deadline).toBe(a.attempt.startedAt + 90 * 60_000);
      expect((await sit("none")).attempt.deadline).toBeNull();
    });

    it("autosaves answers to this set's questions only, and not after handing in", async () => {
      const { set, attempt, engine } = await sit();
      saveAnswers(db, attempt.id, { q1: "1", q4: "An essay.", nope: "ignored" });
      expect(db.select().from(s.examAttempts).get()!.answers).toEqual({ q1: "1", q4: "An essay." });
      await handIn(db, engine, attempt.id);
      saveAnswers(db, attempt.id, { q1: "3" });
      expect(db.select().from(s.examAttempts).get()!.answers.q1).toBe("1");
      void set;
    });

    it("marks multiple choice by code and sends only the answered written questions to the Examiner; unanswered ones are skipped, not marked down", async () => {
      const { set, attempt, engine } = await sit();
      const right = set.questions[0].correct!;
      const essayAnswer = "Madison argues that a large republic dilutes faction, because many interests make a lasting majority unlikely.";
      const done = await handIn(db, engine, attempt.id, { q1: String(right), q2: String((set.questions[1].correct! + 1) % 4), q4: essayAnswer });
      const r = done.feedback!;
      expect(r.results.find((x) => x.id === "q1")).toMatchObject({ by: "code", marksAwarded: 2 });
      expect(r.results.find((x) => x.id === "q2")).toMatchObject({ by: "code", marksAwarded: 0 });
      expect(r.results.find((x) => x.id === "q3")).toMatchObject({ status: "skipped", marksAwarded: 0 });
      expect(r.results.find((x) => x.id === "q4")).toMatchObject({ by: "examiner", status: "marked" });
      expect(r.total).toBe(16);
      expect(r.skipped).toBe(1);
      const exam = asks(engine, "You are the Examiner");
      expect(exam).toHaveLength(1);
      expect(exam[0]).toMatchObject({ model: "claude-opus-5-5", effort: "medium" });
      expect(exam[0].prompt).toContain(essayAnswer);
      expect(exam[0].prompt).toContain("marks are awarded for use of the readings.");
      expect(exam[0].prompt).not.toContain("### q1");
      expect(done.handedInAt).not.toBeNull();
    });

    it("handing in early with nothing answered is fine: no Examiner call, everything skipped", async () => {
      const { attempt, engine } = await sit();
      const done = await handIn(db, engine, attempt.id);
      expect(done.feedback).toMatchObject({ earned: 0, answered: 0, skipped: 4 });
      expect(asks(engine, "You are the Examiner")).toHaveLength(0);
    });

    it("marks are clamped to what the question is worth, and a citation the Examiner made up is removed", async () => {
      const { set, attempt } = await sit();
      const wild = new FakeEngine({ json: (req: AiRequest) => (req.system.includes("You are the Examiner") ? { results: [{ id: "q4", marksAwarded: 99, strengths: "Good. [ghost.pdf, p. 1]", fixes: ["Add the point. [ghost.pdf, p. 9]", "Be specific."] }] } : cannedJson(req)) });
      const done = await handIn(db, wild, attempt.id, { q4: "A long enough answer about faction and the large republic." });
      const q4 = done.feedback!.results.find((x) => x.id === "q4")!;
      expect(q4.marksAwarded).toBe(10);
      expect(JSON.stringify(q4)).not.toContain("ghost.pdf");
      expect(q4.fixes).toContain("Be specific.");
      void set;
    });

    it("Try again is a new attempt on the same questions; the first attempt and its feedback stay", async () => {
      const { set, attempt, engine, examId } = await sit();
      await handIn(db, engine, attempt.id, { q1: "0" });
      const again = startAttempt(db, set.id, "none");
      expect(again.id).not.toBe(attempt.id);
      expect(db.select().from(s.examSets).all()).toHaveLength(1);
      expect(db.select().from(s.examAttempts).all()).toHaveLength(2);
      expect(getExamView(db, examId)!.attempt!.id).toBe(again.id);
      expect(listExams(db, id)[0]).toMatchObject({ sets: 1, attempts: 2, last: { total: 16 } });
    });
  });

  it("deleting an exam removes its sheet, uploaded exams, sets, attempts and files; deleting the project removes them too", async () => {
    const { examId, engine } = await ready();
    const past = (await addFile(db, id, { name: "Past.txt", relPath: "Past.txt", bytes: enc("Past exam."), label: { type: "exam", week: null, reason: null, check: false } })).id;
    attachMaterial(db, examId, past);
    const set = await generateSet(db, engine, examId);
    const a = startAttempt(db, set.id, "none");
    await handIn(db, engine, a.id);
    const stored = db.select({ p: s.files.storedPath }).from(s.files).where(eq(s.files.id, sheet)).get()!.p!;
    expect(fs.existsSync(stored)).toBe(true);
    expect(deleteExam(db, examId)).toBe(true);
    for (const t of [s.exams, s.examMaterials, s.examSets, s.examAttempts]) expect(db.select().from(t).all()).toHaveLength(0);
    expect(db.select().from(s.files).where(eq(s.files.id, sheet)).get()).toBeUndefined();
    expect(fs.existsSync(stored)).toBe(false);

    sheet = (await addFile(db, id, { name: "Final exam instructions.txt", relPath: "Final exam instructions.txt", bytes: enc(SHEET), label: { type: "exam", week: null, reason: null, check: false } })).id;
    const again = await ready();
    await generateSet(db, again.engine, again.examId);
    expect(deleteProject(db, id)).toBe(true);
    for (const t of [s.exams, s.examMaterials, s.examSets, s.examAttempts]) expect(db.select().from(t).all()).toHaveLength(0);
  });
});
