// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { cannedEngine } from "@/lib/ai/canned";
import { FakeEngine } from "@/lib/ai/fake-engine";
import { openDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { getNoteGuide } from "@/lib/layers/note-to-self";
import { editSaved, getThread, saveWriteback, submitWriteback } from "@/lib/layers/writeback";
import { arrowed, draftFromWriteup, getQuickNotes, saveQuickNote } from "@/lib/talk/quicknotes";
import { getTalk, notebookText, talk } from "@/lib/talk/service";
import { collectTalkSources, hasUnread } from "@/lib/talk/sources";
import { arrowText } from "@/components/notebook/QuickNote";
import { makeApprovedProject } from "./helpers/course";

let db: Db;
let projectId: string;
let layers: string[];

beforeEach(async () => {
  db = openDb(":memory:").db;
  const p = await makeApprovedProject(db);
  projectId = p.id;
  layers = p.layers().map((l) => l.id);
});

const drain = async (g: AsyncGenerator<unknown>) => {
  for await (const c of g) void c;
};
const saveOne = async (layerId: string, text: string) => {
  const r = await submitWriteback(db, cannedEngine(), layerId, text);
  saveWriteback(db, layerId, r.writebackId, "own");
};

describe("quick notes", () => {
  it("are saved per layer, come back in the notebook, and never touch the Let's talk! notepad", () => {
    saveQuickNote(db, projectId, "layer", layers[1], "power → factions");
    expect(getQuickNotes(db, projectId)).toEqual({ [`layer:${layers[1]}`]: "power → factions" });
    const guide = getNoteGuide(db, projectId)!;
    const slots = guide.weeks.flatMap((w) => [...w.layers, w.synthesis]);
    expect(slots.find((x) => x.id === layers[1])!.quick).toBe("power → factions");
    expect(slots.find((x) => x.id === layers[0])!.quick).toBe("");
    expect(db.select().from(s.talkNotepad).all()).toEqual([]);
  });

  it("replace the earlier text for that layer, keep one record, and an emptied note leaves nothing behind", () => {
    saveQuickNote(db, projectId, "layer", layers[0], "one");
    saveQuickNote(db, projectId, "layer", layers[0], "two");
    expect(db.select().from(s.quickNotes).all()).toHaveLength(1);
    expect(getQuickNotes(db, projectId)[`layer:${layers[0]}`]).toBe("two");
    saveQuickNote(db, projectId, "layer", layers[0], "  \n ");
    expect(db.select().from(s.quickNotes).all()).toHaveLength(0);
  });

  it("belong to the project: another project's layer is refused", async () => {
    const other = await makeApprovedProject(db, "Other course");
    expect(() => saveQuickNote(db, other.id, "layer", layers[0], "x")).toThrow(/no longer part of this project/);
    expect(db.select().from(s.quickNotes).all()).toHaveLength(0);
  });

  it("turn -> into an arrow, as typed and on save, and keep the caret where it was", () => {
    expect(arrowed("a -> b -> c")).toBe("a → b → c");
    expect(arrowText("cause -> effect", 8)).toEqual({ value: "cause → effect", caret: 7 });
    expect(arrowText("plain", 3)).toEqual({ value: "plain", caret: 3 });
    saveQuickNote(db, projectId, "layer", layers[0], "x -> y");
    expect(getQuickNotes(db, projectId)[`layer:${layers[0]}`]).toBe("x → y");
  });

  it("draft from the saved write-up as arrow lines, using only that write-up, and save nothing", async () => {
    await saveOne(layers[0], "Factions are groups with shared interests. They threaten the republic.");
    const engine = new FakeEngine({ text: "-> one\n-> two" });
    const text = await draftFromWriteup(db, engine, projectId, "layer", layers[0]);
    expect(text.split("\n").every((l) => l.startsWith("→ "))).toBe(true);
    expect(engine.calls[0].prompt).toContain("Factions are groups with shared interests.");
    expect(engine.calls[0].model).toBe("sonnet");
    expect(db.select().from(s.quickNotes).all()).toHaveLength(0);
  });

  it("can't be drafted for a layer with nothing saved", async () => {
    await expect(draftFromWriteup(db, new FakeEngine({ text: "x" }), projectId, "layer", layers[0])).rejects.toThrow(/Send this layer's write-up/);
  });
});

describe("highlight to ask: the topic of a chat message", () => {
  it("saves the highlighted passage with the question, and sends it to the professor with the question", async () => {
    const engine = new FakeEngine({ text: "Answer." });
    await drain(talk(db, engine, projectId, "how can I write this more thoroughly?", { topic: "Factions are groups with shared interests." }));
    expect(getTalk(db, projectId)[0]).toMatchObject({ role: "user", topic: "Factions are groups with shared interests." });
    expect(getTalk(db, projectId)[1].topic).toBeNull();
    expect(engine.calls[0].prompt).toContain("The passage the student highlighted");
    expect(engine.calls[0].prompt).toContain("Factions are groups with shared interests.");
    expect(engine.calls[0].system).toMatch(/highlighted a passage/);
    expect(engine.calls[0].model).toBe("sonnet");
  });

  it("a message with no highlighted passage has no topic and no topic section in the prompt", async () => {
    const engine = new FakeEngine({ text: "Answer." });
    await drain(talk(db, engine, projectId, "a plain question"));
    expect(getTalk(db, projectId)[0].topic).toBeNull();
    expect(engine.calls[0].prompt).not.toContain("highlighted");
  });

  it("keeps the topic on each message, so an earlier topic stays in the history with its passage", async () => {
    await drain(talk(db, new FakeEngine({ text: "A." }), projectId, "first", { topic: "Passage one" }));
    await drain(talk(db, new FakeEngine({ text: "B." }), projectId, "follow-up", { topic: "Passage one" }));
    await drain(talk(db, new FakeEngine({ text: "C." }), projectId, "new topic", { topic: "Passage two" }));
    expect(getTalk(db, projectId).filter((m) => m.role === "user").map((m) => m.topic)).toEqual(["Passage one", "Passage one", "Passage two"]);
  });
});

describe("editing a saved write-up in the notebook", () => {
  it("changes the saved text and the text the layer's pane shows (own writing), keeping the label", async () => {
    await saveOne(layers[0], "My first version of the layer.");
    const out = editSaved(db, "layer", layers[0], "My edited -> version.");
    expect(out).toEqual({ version: "own", text: "My edited → version." });
    const thread = getThread(db, layers[0]);
    expect(thread.saved).toMatchObject({ version: "own", text: "My edited → version." });
    expect(thread.messages.find((m) => m.kind === "writeback")!.content).toBe("My edited → version.");
    expect(getNoteGuide(db, projectId)!.weeks[0].layers[0].final).toEqual({ text: "My edited → version.", version: "own" });
  });

  it("changes the cleaned-up version the pane shows for a refined save", async () => {
    const r = await submitWriteback(db, cannedEngine(), layers[1], "Plain words about the layer.");
    saveWriteback(db, layers[1], r.writebackId, "refined");
    editSaved(db, "layer", layers[1], "Better words about the layer.");
    const thread = getThread(db, layers[1]);
    expect(thread.saved).toMatchObject({ version: "refined", text: "Better words about the layer." });
    expect(thread.messages.find((m) => m.kind === "review")!.review!.cleanedUp).toBe("Better words about the layer.");
    expect(thread.messages.find((m) => m.kind === "writeback")!.content).toBe("Plain words about the layer."); // what was submitted stays
  });

  it("refuses an empty write-up, and a layer with nothing saved", async () => {
    await saveOne(layers[0], "Something saved.");
    expect(() => editSaved(db, "layer", layers[0], "  ")).toThrow(/can't be empty/);
    expect(() => editSaved(db, "layer", layers[2], "x")).toThrow(/Nothing is saved/);
    expect(getThread(db, layers[0]).saved!.text).toBe("Something saved.");
  });
});

describe("the Note to Self chat is its own conversation", () => {
  it("keeps its own history, separate from Let's talk!, and Let's talk! never sees it", async () => {
    await drain(talk(db, new FakeEngine({ text: "From the section." }), projectId, "section question"));
    await drain(talk(db, new FakeEngine({ text: "About my notes." }), projectId, "notes question", { channel: "note", topic: "A passage" }));
    expect(getTalk(db, projectId).map((m) => m.content)).toEqual(["section question", "From the section."]);
    expect(getTalk(db, projectId, "note").map((m) => m.content)).toEqual(["notes question", "About my notes."]);
    expect(getTalk(db, projectId, "note")[0].topic).toBe("A passage");
  });

  it("has Let's talk!'s search and citation checking, and also sees the saved write-ups and quick notes", async () => {
    await saveOne(layers[0], "Factions are groups with shared interests.");
    saveQuickNote(db, projectId, "layer", layers[0], "factions → danger");
    const hit = db.select().from(s.passages).all()[7];
    const word = hit.text.split(/\s+/).find((w) => /^kw\d+q$/.test(w))!;
    const file = db.select().from(s.files).all().find((f) => f.id === hit.fileId)!.name;
    const engine = new FakeEngine({ text: `Real [${file}, p. ${hit.page}] and invented [nowhere.pdf, p. 99].` });
    await drain(talk(db, engine, projectId, `explain ${word}`, { channel: "note" }));
    const call = engine.calls[0];
    expect(call.system).toContain("study partner for their Note to Self notebook");
    expect(call.system).not.toContain("You are the student's professor");
    expect(call.prompt).toContain("The student's notebook");
    expect(call.prompt).toContain("Factions are groups with shared interests.");
    expect(call.prompt).toContain("factions → danger");
    expect(call.prompt).toContain(`[${file}, p. ${hit.page}]`); // the whole course is searched
    expect(call.model).toBe("sonnet");
    const saved = getTalk(db, projectId, "note").at(-1)!.content;
    expect(saved).toContain(`[${file}, p. ${hit.page}]`);
    expect(saved).not.toContain("nowhere.pdf"); // a citation that was not sent is stripped
  });

  it("shows an edited write-up, not the old one, and is empty when nothing is written", async () => {
    expect(notebookText(db, projectId)).toBe("");
    await saveOne(layers[0], "Old text.");
    editSaved(db, "layer", layers[0], "New text.");
    expect(notebookText(db, projectId)).toContain("New text.");
    expect(notebookText(db, projectId)).not.toContain("Old text.");
  });

  it("is not read by the Librarian: only Let's talk! feeds the sources", async () => {
    await drain(talk(db, new FakeEngine({ text: "About my notes." }), projectId, "a notes question", { channel: "note" }));
    expect(hasUnread(db, projectId)).toBe(false);
    const out = await collectTalkSources(db, cannedEngine(), projectId);
    expect(out).toMatchObject({ added: 0, skipped: "nothing-new" });
  });
});
