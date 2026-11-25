// @vitest-environment node
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import mammoth from "mammoth";
import { toDocx, toPdf, winAnsi } from "@/lib/agents/export";
import { declineReason, deleteRequest, getDocument, listRequests, remainingToday, routeRequest, submitRequest } from "@/lib/agents/requests";
import { listTasks } from "@/lib/agents/tasks";
import { cannedEngine, cannedJson } from "@/lib/ai/canned";
import type { AiRequest } from "@/lib/ai/engine";
import { FakeEngine } from "@/lib/ai/fake-engine";
import { agentDocumentSchema } from "@/lib/ai/schemas";
import { openDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { saveWriteback, submitWriteback } from "@/lib/layers/writeback";
import { getStructure } from "@/lib/layers/service";
import { deleteProject } from "@/lib/projects/delete";
import { parsePdf } from "@/lib/import/parse-pdf";
import { saveNotepad } from "@/lib/talk/notepad";
import { saveWeekNotes } from "@/lib/weeks/notes";
import { makeApprovedProject } from "./helpers/course";

beforeAll(() => {
  process.env.MARGIN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "margin-agentreq-"));
});

describe("routing a note to the right agent", () => {
  it.each([
    ["Make me a one-page study guide for the first half", "explainer"],
    ["Explain faction in plain words", "explainer"],
    ["A checklist for planning an essay on checks and balances", "examiner"],
    ["Give me practice questions on Federalist 10", "quizzer"],
    ["How do the readings connect to each other? A timeline of the argument", "connector"],
    ["Find every passage about the veto", "librarian"],
    ["something unclear", "explainer"],
  ] as const)("%s -> %s", (note, agent) => expect(routeRequest(note)).toBe(agent));
});

describe("graded work", () => {
  it("is refused kindly, with something to do instead", () => {
    for (const note of ["Write my essay on faction", "do my homework for week 3", "Answer the quiz questions so I can submit them", "write the response paper that is due tomorrow, for marks"]) {
      const no = declineReason(note);
      expect(no, note).not.toBeNull();
      expect(no!.message).toMatch(/can't write work that you hand in for a grade/);
      expect(no!.alternative).toMatch(/essay plan checklist/);
    }
  });
  it("does not stop honest requests that mention essays or exams", () => {
    for (const note of ["A checklist for planning my essay on faction", "Explain what the midterm covers", "Practice questions for the exam", "Summarise the paper by Madison", "Find passages for my essay"]) expect(declineReason(note), note).toBeNull();
  });
});

describe("leaving a note for the agents", () => {
  let db: Db;
  let id: string;
  beforeEach(async () => {
    db = openDb(":memory:").db;
    id = (await makeApprovedProject(db)).id;
    delete process.env.MARGIN_AGENT_REQUESTS_PER_DAY;
  });
  const word = () => db.select().from(s.passages).where(eq(s.passages.projectId, id)).all()[2].text.split(/\s+/).find((w) => /^kw\d+q$/.test(w))!;

  it("records the work so the dining hall shows the agent busy, then announces the result", async () => {
    const engine = cannedEngine();
    const r = submitRequest(db, engine, id, `Make me a study guide about ${word()}`);
    expect(r.kind).toBe("started");
    if (r.kind !== "started") return;
    expect(r.agent).toBe("explainer");
    expect(listTasks(db, id).running).toMatchObject([{ agent: "explainer", kind: "make-document" }]);
    await r.done;
    expect(listTasks(db, id).running).toEqual([]);
    expect(listTasks(db, id).unseen[0].result).toMatch(/^Made “.+”\. It is in Ready for you\./);
    const list = listRequests(db, id);
    expect(list.ready).toHaveLength(1);
    expect(list.ready[0]).toMatchObject({ agent: "explainer", status: "done" });
  });

  it("builds only from the student's own files and writing: matching passages, saved write-ups and the notepad, and never the lecture notes", async () => {
    const layer = getStructure(db, id)!.weeks.flatMap((w) => w.layers)[0];
    const rev = await submitWriteback(db, cannedEngine(), layer.id, "My own words about SAVEDWRITEUP in the first layer.");
    saveWriteback(db, layer.id, rev.writebackId, "own");
    saveNotepad(db, id, [{ type: "paragraph", text: "NOTEPADLINE about the course" }]);
    saveWeekNotes(db, id, 2, [{ type: "paragraph", text: "SECRETWEEKNOTE" }]);
    const engine = cannedEngine();
    const r = submitRequest(db, engine, id, `Make a study guide about ${word()}`);
    if (r.kind === "started") await r.done;
    const call = engine.calls.find((c) => c.system.includes("The student left you a note"))!;
    expect(call).toMatchObject({ model: "claude-opus-5-5", effort: "medium" });
    expect(call.prompt).toContain("SAVEDWRITEUP");
    expect(call.prompt).toContain("NOTEPADLINE");
    expect(call.prompt).toContain("[Your notepad, p. 1]");
    expect(call.prompt).not.toContain("SECRETWEEKNOTE");
    expect(call.system).toMatch(/NEVER do graded work/);
    expect(call.system).toContain("ONLY from the passages");
  });

  it("every citation in what was made points at a passage that was sent; a made-up one is stripped", async () => {
    const wild = new FakeEngine({
      json: (req: AiRequest) => (req.system.includes("The student left you a note") ? { declined: null, title: "A guide", blocks: [{ type: "heading", text: "H" }, { type: "bullets", items: ["Real claim. [Your notepad, p. 1]", "Invented. [ghost.pdf, p. 9]"] }] } : cannedJson(req)),
    });
    saveNotepad(db, id, [{ type: "paragraph", text: `about ${word()}` }]);
    const r = submitRequest(db, wild, id, `A guide about ${word()}`);
    if (r.kind === "started") await r.done;
    const doc = getDocument(db, listRequests(db, id).ready[0].id)!;
    expect(JSON.stringify(doc.blocks)).not.toContain("ghost.pdf");
    expect(JSON.stringify(doc.blocks)).toContain("[Your notepad, p. 1]");
  });

  it("refuses graded work before anything is sent, records nothing and uses none of today's notes", () => {
    const engine = cannedEngine();
    const r = submitRequest(db, engine, id, "Write my essay on faction, it is due tomorrow");
    expect(r).toMatchObject({ kind: "refused", message: expect.stringMatching(/hand in for a grade/) });
    expect(engine.calls).toHaveLength(0);
    expect(db.select().from(s.agentRequests).all()).toHaveLength(0);
    expect(db.select().from(s.agentTasks).all()).toHaveLength(0);
    expect(remainingToday(db, id)).toBe(8);
  });

  it("if the agent itself sees graded work in a note that slipped past, it declines with an alternative", async () => {
    const sly = new FakeEngine({ json: (req: AiRequest) => (req.system.includes("The student left you a note") ? { declined: { message: "I can't write work that is handed in for a grade.", alternative: "I can make an essay plan checklist instead." }, title: "Not written", blocks: [] } : cannedJson(req)) });
    const r2 = submitRequest(db, sly, id, `A polished piece on ${word()} that my tutor will read`);
    if (r2.kind === "started") await r2.done;
    const list = listRequests(db, id);
    expect(list.ready).toEqual([]);
    expect(list.open[0]).toMatchObject({ status: "declined", note: expect.stringContaining("essay plan checklist") });
  });

  it("a daily limit keeps the usage in check, and says so plainly", async () => {
    process.env.MARGIN_AGENT_REQUESTS_PER_DAY = "2";
    for (let i = 0; i < 2; i++) {
      const r = submitRequest(db, cannedEngine(), id, `Study guide number ${i} about ${word()}`);
      if (r.kind === "started") await r.done;
    }
    expect(remainingToday(db, id)).toBe(0);
    expect(() => submitRequest(db, cannedEngine(), id, `One more study guide about ${word()}`)).toThrow(/used today's 2 notes/);
    expect(db.select().from(s.agentRequests).all()).toHaveLength(2);
    // deleting a document does not give a note back
    deleteRequest(db, listRequests(db, id).ready[0].id);
    expect(remainingToday(db, id)).toBe(0);
    // tomorrow it does
    const tomorrow = new Date(Date.now() + 36 * 3600_000);
    expect(remainingToday(db, id, tomorrow)).toBe(2);
  });

  it("the Librarian's document is made by code: matching passages, verbatim, each with file and page; no model, no note used", async () => {
    const engine = cannedEngine();
    const r = submitRequest(db, engine, id, `Find the passages about ${word()}`);
    expect(r).toMatchObject({ kind: "started", agent: "librarian" });
    if (r.kind === "started") await r.done;
    expect(engine.calls).toHaveLength(0);
    expect(remainingToday(db, id)).toBe(8);
    const doc = getDocument(db, listRequests(db, id).ready[0].id)!;
    const passages = db.select().from(s.passages).where(eq(s.passages.projectId, id)).all();
    const paras = doc.blocks.filter((b) => b.type === "paragraph") as { text: string }[];
    expect(paras.length).toBeGreaterThan(0);
    for (const p of paras) {
      const body = p.text.replace(/ \[[^\]]+, p\. \d+\]$/, "");
      expect(passages.some((x) => x.text === body)).toBe(true); // verbatim
    }
  });

  it("says plainly when there is nothing to build from, without asking a model", async () => {
    const engine = cannedEngine();
    const r = submitRequest(db, engine, id, "Study guide about zzqxyzzy");
    if (r.kind === "started") await r.done;
    expect(engine.calls).toHaveLength(0);
    const row = db.select().from(s.agentRequests).get()!;
    expect(row).toMatchObject({ status: "failed" });
    expect(row.note).toMatch(/nothing to build from/);
    expect(listTasks(db, id).running).toEqual([]);
  });

  it("a note needs words and not too many", () => {
    expect(() => submitRequest(db, cannedEngine(), id, "  ")).toThrow(/Say what/);
    expect(() => submitRequest(db, cannedEngine(), id, "x".repeat(900))).toThrow(/under 800/);
  });

  it("deleting a document deletes it for good, and deleting the project deletes its notes too", async () => {
    const r = submitRequest(db, cannedEngine(), id, `Study guide about ${word()}`);
    if (r.kind === "started") await r.done;
    const docId = listRequests(db, id).ready[0].id;
    expect(deleteRequest(db, docId)).toBe(true);
    expect(getDocument(db, docId)).toBeNull();
    const again = submitRequest(db, cannedEngine(), id, `Another study guide about ${word()}`);
    if (again.kind === "started") await again.done;
    expect(deleteProject(db, id)).toBe(true);
    expect(db.select().from(s.agentRequests).all()).toHaveLength(0);
  });
});

describe("what the model may return", () => {
  it("a document needs cited blocks, or a decline with a message and an alternative", () => {
    const ok = { declined: null, title: "A study guide", blocks: [{ type: "heading", text: "H" }, { type: "bullets", items: ["Claim. [a.txt, p. 1]"] }] };
    expect(agentDocumentSchema.safeParse(ok).success).toBe(true);
    expect(agentDocumentSchema.safeParse({ ...ok, blocks: [{ type: "heading", text: "H" }, { type: "paragraph", text: "No cite" }] }).success).toBe(false);
    expect(agentDocumentSchema.safeParse({ ...ok, blocks: [ok.blocks[0]] }).success).toBe(false);
    expect(agentDocumentSchema.safeParse({ declined: { message: "I can't do that.", alternative: "I can make a checklist." }, title: "Not written", blocks: [] }).success).toBe(true);
  });
});

describe("downloads", () => {
  const doc = { id: "d1", agent: "explainer" as const, title: "A study guide: “faction”", request: "x", createdAt: 1, blocks: [{ type: "heading" as const, text: "What your files say" }, { type: "paragraph" as const, text: "Madison fears faction (see below) — a lot. [federalist-10.pdf, p. 3]" }, { type: "bullets" as const, items: ["First point [a.txt, p. 1]", "Second point [a.txt, p. 2]"] }] };

  it("a Word file opens and says the same words", async () => {
    const bytes = await toDocx(doc);
    const text = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
    expect(text).toContain("A study guide: “faction”");
    expect(text).toContain("What your files say");
    expect(text).toContain("Madison fears faction (see below) — a lot. [federalist-10.pdf, p. 3]");
    expect(text).toContain("Second point [a.txt, p. 2]");
    expect(text).toContain("Made by the Explainer in Margin");
  });

  it("a PDF opens, wraps long lines and runs onto a second page when it must", async () => {
    const long = { ...doc, blocks: Array.from({ length: 40 }, (_, i) => ({ type: "paragraph" as const, text: `Paragraph ${i}: ${Array.from({ length: 40 }, (_, k) => `word${i}x${k}`).join(" ")} [a.txt, p. 1]` })) };
    const parsed = await parsePdf(toPdf(long));
    expect(parsed.pageCount).toBeGreaterThan(1);
    const text = parsed.blocks.map((b) => b.text).join(" ");
    expect(text).toContain("Paragraph 39");
    expect(text).toContain("Paragraph 0");
    const single = await parsePdf(toPdf(doc));
    expect(single.pageCount).toBe(1);
    expect(single.blocks.map((b) => b.text).join(" ")).toContain("Madison fears faction");
  });

  it("typographic marks become plain ones in the PDF and nothing breaks it", () => {
    expect(winAnsi("“quoted” – dash … and → arrow ✓")).toBe('"quoted" - dash ... and -> arrow ?');
  });
});
