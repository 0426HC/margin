// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { cannedEngine, cannedJson } from "@/lib/ai/canned";
import { FakeEngine } from "@/lib/ai/fake-engine";
import { dbPath, filesDir } from "@/lib/db/paths";
import { openDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { searchPassages } from "@/lib/db/search";
import { demoSeedSchema, importDemoSeed } from "@/lib/demo/seed";
import { getNoteToSelf } from "@/lib/layers/note-to-self";
import { StructureError } from "@/lib/layers/service";
import { dontGetIt, getThread, removeSaved, saveSynthesis, saveWriteback, submitSynthesis, submitWriteback } from "@/lib/layers/writeback";
import { deleteProject } from "@/lib/projects/delete";
import { addFile, createProject } from "@/lib/projects/service";
import { saveNotepad } from "@/lib/talk/notepad";
import { saveWeekNotes } from "@/lib/weeks/notes";
import { submitRequest } from "@/lib/agents/requests";
import { createExam, generateSet, handIn, saveExamSummary, startAttempt } from "@/lib/exam/service";
import { getQuickNotes, saveQuickNote } from "@/lib/talk/quicknotes";
import { clearTalk, deleteTalkMessage, getTalk, talk } from "@/lib/talk/service";
import { collectTalkSources, deleteSource, getSources, hasUnread } from "@/lib/talk/sources";
import { makeApprovedProject } from "./helpers/course";

// Every test file gets its own throwaway data folder (tests/setup.ts), so nothing here can touch the real .data.

const drain = async (g: AsyncGenerator<unknown>) => {
  for await (const c of g) void c;
};
const wordIn = (db: Db, projectId: string, n: number) => db.select().from(s.passages).where(eq(s.passages.projectId, projectId)).all()[n].text.split(/\s+/).find((w) => /^kw\d+q$/.test(w))!;
const librarian = () => new FakeEngine({ json: cannedJson as never });
const chat = (db: Db, projectId: string, q: string, from?: Parameters<typeof talk>[4]) => drain(talk(db, new FakeEngine({ text: "It is about this. [x.pdf, p. 1]" }), projectId, q, from));

/** A project with something in every place a project keeps data. */
async function populate(db: Db, name: string) {
  const p = await makeApprovedProject(db, name);
  const layers = p.layers();
  const send = async (i: number, choice: "own" | "refined") => {
    const r = await submitWriteback(db, cannedEngine(), layers[i].id, `${name}: my words about layer ${i}, in my own way.`);
    saveWriteback(db, layers[i].id, r.writebackId, choice);
  };
  await send(0, "own");
  await send(1, "refined");
  await drain(dontGetIt(db, cannedEngine(), layers[2].id, "I am lost"));
  const part = db.select().from(s.parts).where(eq(s.parts.projectId, p.id)).all().sort((x, y) => x.position - y.position)[0]; // week 1
  const syn = await submitSynthesis(db, cannedEngine(), part.id, `${name}: how the layers fit together.`);
  saveSynthesis(db, part.id, syn.writebackId, "own");
  saveQuickNote(db, p.id, "layer", layers[0].id, "a -> b");
  saveQuickNote(db, p.id, "part", part.id, "synthesis notes");
  await chat(db, p.id, `tell me about ${wordIn(db, p.id, 3)}`, { layerId: layers[0].id });
  await chat(db, p.id, "what does this passage mean?", { topic: "A highlighted passage", channel: "note" });
  saveNotepad(db, p.id, [{ type: "heading", text: `${name} notes` }, { type: "bullet", text: "one point" }]);
  saveWeekNotes(db, p.id, 2, [{ type: "paragraph", text: `${name}: what the lecture said in week 2` }]);
  await collectTalkSources(db, librarian(), p.id);
  // a note for the agents, and the document they made
  const note = submitRequest(db, cannedEngine(), p.id, `Make me a study guide about ${wordIn(db, p.id, 3)}`);
  if (note.kind === "started") await note.done;
  // an exam with its sheet, a past exam, a practice set and a handed-in attempt
  const sheet = await addFile(db, p.id, { name: "Midterm exam instructions.txt", relPath: "Midterm exam instructions.txt", bytes: new TextEncoder().encode("Midterm exam instructions. Time allowed: 60 minutes. Section A: multiple choice. Section B: essay."), label: { type: "exam", week: null, reason: null, check: false } });
  const examId = createExam(db, p.id, sheet.id);
  const exam = cannedEngine();
  const { summary } = { summary: await (await import("@/lib/exam/service")).readExamSummary(db, exam, examId) };
  saveExamSummary(db, examId, summary, true);
  const past = await addFile(db, p.id, { name: "Past exam.txt", relPath: "Past exam.txt", bytes: new TextEncoder().encode("Past exam. Explain faction."), label: { type: "exam", week: null, reason: null, check: false } });
  (await import("@/lib/exam/service")).attachMaterial(db, examId, past.id);
  const set = await generateSet(db, exam, examId);
  const attempt = startAttempt(db, set.id, "none");
  await handIn(db, exam, attempt.id, { q1: "0", q4: "A written answer that is long enough to be marked by the examiner." });
  return { id: p.id, layers: layers.map((l) => l.id), partId: part.id };
}

/** Row counts of every ordinary table (the full-text index's own internals are checked separately). */
function counts(sqlite: ReturnType<typeof openDb>["sqlite"]) {
  const tables = (sqlite.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like 'passages_fts%' and name != '__drizzle_migrations' order by name").all() as { name: string }[]).map((t) => t.name);
  return Object.fromEntries(tables.map((t) => [t, (sqlite.prepare(`select count(*) as c from "${t}"`).get() as { c: number }).c]));
}

describe("deleting a project", () => {
  it("leaves the database exactly as if the project had never existed, and other projects untouched", async () => {
    const only = openDb(":memory:");
    const b1 = await populate(only.db, "POL202 Other course");

    const both = openDb(":memory:");
    const a = await populate(both.db, "POL101 To delete");
    const b2 = await populate(both.db, "POL202 Other course");
    const before = counts(both.sqlite);
    const expected = counts(only.sqlite);

    // the seeding really did fill every kind of table, so "equal after" means something
    for (const t of ["units", "files", "sections", "passages", "parts", "layers", "layer_passages", "writebacks", "layer_messages", "note_saves", "quick_notes", "talk_messages", "talk_sources", "talk_notepad", "week_notes", "exams", "exam_materials", "exam_sets", "exam_attempts", "agent_requests", "agent_tasks", "ui_state"]) {
      expect(before[t], t).toBeGreaterThan(expected[t]);
    }

    expect(deleteProject(both.db, a.id)).toBe(true);
    expect(counts(both.sqlite)).toEqual(expected);

    // nothing of the deleted project can be found any more, anywhere
    expect(both.db.select().from(s.projects).all().map((p) => p.id)).toEqual([b2.id]);
    for (const t of ["writebacks", "layer_messages", "note_saves"]) {
      const orphans = both.sqlite.prepare(`select count(*) as c from ${t} where target_id in (${[...a.layers, a.partId].map(() => "?").join(",")})`).get(...a.layers, a.partId) as { c: number };
      expect(orphans.c, `${t} of the deleted project's layers`).toBe(0);
    }
    expect(both.sqlite.prepare("select count(*) as c from passages_fts_docsize").get()).toEqual({ c: (both.sqlite.prepare("select count(*) as c from passages").get() as { c: number }).c });
    expect(searchPassages(both.db, a.id, wordIn(only.db, b1.id, 0), 5)).toEqual([]);

    // the other project is unchanged and still searchable, and its words are intact
    expect(getTalk(both.db, b2.id)).toHaveLength(getTalk(only.db, b1.id).length);
    expect(getTalk(both.db, b2.id, "note")).toHaveLength(2);
    expect(getSources(both.db, b2.id).flatMap((g) => g.sources)).toHaveLength(getSources(only.db, b1.id).flatMap((g) => g.sources).length);
    expect(getNoteToSelf(both.db, b2.id).flatMap((p) => p.layers)).toHaveLength(2);
    expect(Object.keys(getQuickNotes(both.db, b2.id))).toHaveLength(2);
    expect(getThread(both.db, b2.layers[0])!.saved?.version).toBe("own");
    expect(searchPassages(both.db, b2.id, wordIn(both.db, b2.id, 0), 5).length).toBeGreaterThan(0);
  });

  it("removes the project's stored files from disk and leaves other projects' files alone", async () => {
    const { db } = openDb(":memory:");
    const a = await populate(db, "POL101 To delete");
    const b = await populate(db, "POL202 Other course");
    const dirA = path.join(filesDir(), a.id);
    const dirB = path.join(filesDir(), b.id);
    expect(fs.readdirSync(dirA).length).toBeGreaterThan(0);
    const filesOfB = fs.readdirSync(dirB);
    expect(filesOfB.length).toBeGreaterThan(0);

    deleteProject(db, a.id);

    expect(fs.existsSync(dirA)).toBe(false);
    expect(fs.readdirSync(dirB)).toEqual(filesOfB);
    expect(db.select({ p: s.files.storedPath }).from(s.files).all().every((f) => f.p?.startsWith(dirB))).toBe(true);
  });

  it("leaves no readable trace of the deleted text in the database file or its log", async () => {
    const file = dbPath();
    const { db, sqlite } = openDb(file);
    const id = createProject(db, { name: "POL101 Secret course" });
    const MARK = "zxqmarkerwordq";
    await addFile(db, id, { name: "secret.txt", relPath: "secret.txt", bytes: new TextEncoder().encode(`Heading\n\n${MARK} appears in the stored file ${MARK}.`) });
    db.insert(s.talkMessages).values({ id: "m1", projectId: id, role: "user", content: `${MARK} in a chat message`, channel: "talk", createdAt: 1 }).run();
    saveNotepad(db, id, [{ type: "paragraph", text: `${MARK} in the notepad` }]);
    const keep = await populate(db, "POL202 Keeper");
    sqlite.pragma("wal_checkpoint(TRUNCATE)");
    const readAll = () => [file, `${file}-wal`].filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f)).reduce((x, y) => Buffer.concat([x, y]), Buffer.alloc(0));
    expect(readAll().toString("latin1").toLowerCase()).toContain(MARK); // it really was in the file before

    deleteProject(db, id);

    expect(readAll().toString("latin1").toLowerCase()).not.toContain(MARK);
    expect(db.select().from(s.projects).all().map((p) => p.id)).toEqual([keep.id]);
    sqlite.close();
  });

  it("refuses an unknown project and a path-like id, and deletes nothing", async () => {
    const { db } = openDb(":memory:");
    const a = await populate(db, "POL101 Course");
    const before = fs.readdirSync(filesDir());
    expect(deleteProject(db, "does-not-exist")).toBe(false);
    expect(deleteProject(db, "../")).toBe(false);
    expect(deleteProject(db, "")).toBe(false);
    expect(fs.readdirSync(filesDir())).toEqual(before);
    expect(db.select().from(s.projects).all().map((p) => p.id)).toEqual([a.id]);
  });

  it("can delete the demo project, and the demo can be opened again afterwards as a fresh copy without the student's work", async () => {
    const { db } = openDb(":memory:");
    const seed = demoSeedSchema.parse(JSON.parse(fs.readFileSync(path.join(process.cwd(), "demo", "seed.json"), "utf8")));
    const first = importDemoSeed(db, seed);
    expect(importDemoSeed(db, seed)).toBe(first); // one demo at a time
    saveQuickNote(db, first, "layer", db.select().from(s.layers).all()[0].id, "my own note");
    expect(deleteProject(db, first)).toBe(true);
    expect(db.select().from(s.projects).all()).toEqual([]);
    expect(db.select().from(s.quickNotes).all()).toEqual([]);

    const again = importDemoSeed(db, seed);
    expect(again).not.toBe(first);
    expect(db.select().from(s.projects).where(eq(s.projects.isDemo, true)).all()).toHaveLength(1);
    expect(db.select().from(s.quickNotes).all()).toEqual([]);
  });
});

describe("deleting chat messages", () => {
  let db: Db;
  let pid: string;
  let other: string;
  beforeEach(async () => {
    db = openDb(":memory:").db;
    pid = (await makeApprovedProject(db, "POL101 One")).id;
    other = (await makeApprovedProject(db, "POL202 Two")).id;
  });

  it("deleting a question deletes its reply too, and nothing else", async () => {
    await chat(db, pid, "first question");
    await chat(db, pid, "second question");
    await chat(db, other, "another project's question");
    const [q1, a1, q2, a2] = getTalk(db, pid);
    expect(deleteTalkMessage(db, pid, q1.id)).toBe(2);
    expect(getTalk(db, pid).map((m) => m.id)).toEqual([q2.id, a2.id]);
    expect(db.select().from(s.talkMessages).where(eq(s.talkMessages.id, a1.id)).all()).toEqual([]);
    expect(getTalk(db, other)).toHaveLength(2);
  });

  it("deleting an answer deletes only that answer", async () => {
    await chat(db, pid, "first question");
    const [q, a] = getTalk(db, pid);
    expect(deleteTalkMessage(db, pid, a.id)).toBe(1);
    expect(getTalk(db, pid).map((m) => m.id)).toEqual([q.id]);
  });

  it("never reaches into another project, and says so when the message is gone", async () => {
    await chat(db, other, "theirs");
    const [theirs] = getTalk(db, other);
    expect(deleteTalkMessage(db, pid, theirs.id)).toBe(0);
    expect(getTalk(db, other)).toHaveLength(2);
    expect(deleteTalkMessage(db, pid, "no-such-message")).toBe(0);
  });

  it("keeps the two conversations apart: Let's talk! and the Note to Self chat", async () => {
    await chat(db, pid, "in talk");
    await chat(db, pid, "in notes", { topic: "A passage", channel: "note" });
    const [nq] = getTalk(db, pid, "note");
    expect(deleteTalkMessage(db, pid, nq.id)).toBe(2);
    expect(getTalk(db, pid, "note")).toEqual([]);
    expect(getTalk(db, pid)).toHaveLength(2);
  });

  it("'Clear conversation' empties one conversation of one project, for good", async () => {
    await chat(db, pid, "in talk");
    await chat(db, pid, "in notes", { topic: "A passage", channel: "note" });
    await chat(db, other, "elsewhere");
    expect(clearTalk(db, pid, "note")).toBe(2);
    expect(getTalk(db, pid, "note")).toEqual([]);
    expect(getTalk(db, pid)).toHaveLength(2);
    expect(clearTalk(db, pid, "talk")).toBe(2);
    expect(db.select().from(s.talkMessages).where(eq(s.talkMessages.projectId, pid)).all()).toEqual([]);
    expect(getTalk(db, other)).toHaveLength(2);
  });

  it("the Librarian still reads what is said after the conversation was cleared", async () => {
    const one = openDb(":memory:").db;
    const id = (await makeApprovedProject(one, "POL101 Solo")).id;
    await chat(one, id, `tell me about ${wordIn(one, id, 3)}`);
    await collectTalkSources(one, librarian(), id);
    expect(hasUnread(one, id)).toBe(false);

    clearTalk(one, id, "talk");
    await chat(one, id, `and about ${wordIn(one, id, 5)}`); // new rows reuse the numbers the old ones had
    expect(hasUnread(one, id)).toBe(true);
    const r = await collectTalkSources(one, librarian(), id);
    expect(r.skipped).toBeUndefined();
  });
});

describe("deleting a collected source", () => {
  it("removes just that source, only from its own project", async () => {
    const { db } = openDb(":memory:");
    const a = await populate(db, "POL101 One");
    const b = await populate(db, "POL202 Two");
    const mine = getSources(db, a.id).flatMap((g) => g.sources);
    const theirs = getSources(db, b.id).flatMap((g) => g.sources);
    expect(mine.length).toBeGreaterThan(0);

    expect(deleteSource(db, b.id, mine[0].id)).toBe(false); // the wrong project can't delete it
    expect(getSources(db, a.id).flatMap((g) => g.sources)).toHaveLength(mine.length);

    expect(deleteSource(db, a.id, mine[0].id)).toBe(true);
    expect(getSources(db, a.id).flatMap((g) => g.sources).map((x) => x.id)).not.toContain(mine[0].id);
    expect(getSources(db, a.id).flatMap((g) => g.sources)).toHaveLength(mine.length - 1);
    expect(getSources(db, b.id).flatMap((g) => g.sources)).toHaveLength(theirs.length);
    expect(deleteSource(db, a.id, mine[0].id)).toBe(false);
  });
});

describe("removing a saved Note to Self entry", () => {
  it("takes it out of the notebook with its quick notes, keeps the layer and its write-ups, and lets the student send a version again", async () => {
    const { db } = openDb(":memory:");
    const a = await populate(db, "POL101 One");
    const b = await populate(db, "POL202 Two");
    const entries = (id: string) => getNoteToSelf(db, id).flatMap((p) => [...p.layers, ...(p.synthesis ? [p.synthesis] : [])]);
    expect(entries(a.id)).toHaveLength(3); // two layers and the synthesis

    const thread = getThread(db, a.layers[0])!;
    expect(thread.saved?.version).toBe("own");
    const writebackId = thread.saved!.writebackId;

    expect(removeSaved(db, a.id, "layer", a.layers[0])).toBe(true);

    expect(entries(a.id).map((e) => e.id)).toEqual([a.partId, a.layers[1]]); // course order: week 1's synthesis, then week 2's layer
    expect(getQuickNotes(db, a.id)[`layer:${a.layers[0]}`]).toBeUndefined();
    expect(getQuickNotes(db, a.id)[`part:${a.partId}`]).toBe("synthesis notes"); // the others' notes stay
    const after = getThread(db, a.layers[0])!;
    expect(after.saved).toBeNull();
    expect(after.messages.some((m) => m.kind === "writeback")).toBe(true); // the layer's write-up and chat remain
    expect(db.select().from(s.writebacks).where(eq(s.writebacks.id, writebackId)).get()?.saveChoice).toBeNull();
    expect(entries(b.id)).toHaveLength(3);

    saveWriteback(db, a.layers[0], writebackId, "own"); // and it can be sent again
    expect(entries(a.id)).toHaveLength(3);
  });

  it("works for a Part synthesis, says nothing was removed when nothing was saved, and never reaches another project", async () => {
    const { db } = openDb(":memory:");
    const a = await populate(db, "POL101 One");
    const b = await populate(db, "POL202 Two");
    expect(removeSaved(db, a.id, "part", a.partId)).toBe(true);
    expect(getNoteToSelf(db, a.id).some((p) => p.synthesis)).toBe(false);
    expect(removeSaved(db, a.id, "part", a.partId)).toBe(false);
    expect(() => removeSaved(db, a.id, "layer", b.layers[0])).toThrow(StructureError);
    expect(getNoteToSelf(db, b.id).flatMap((p) => p.layers)).toHaveLength(2);
    expect(db.select().from(s.noteSaves).where(eq(s.noteSaves.targetId, b.layers[0])).all()).toHaveLength(1);
  });
});

describe("the unit-test data folder", () => {
  it("is a throwaway folder, never the real .data", () => {
    const dir = process.env.MARGIN_DATA_DIR!;
    expect(dir).toBeTruthy();
    expect(path.resolve(dir)).not.toBe(path.resolve(process.cwd(), ".data"));
    expect(path.resolve(filesDir()).startsWith(path.resolve(dir))).toBe(true);
  });
});
