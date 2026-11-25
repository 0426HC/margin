// @vitest-environment node
/**
 * The course brain: every course file read in full, notes on what matters merged across files and linked, read in week order in the
 * background, paused and resumed; Let's talk!, the Note to Self chat and the agents finding their material through it, with a word-search
 * fallback for weeks not read yet. Claude's part is played by scripted answers; the fake engine and a temporary data folder only.
 */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cannedEngine, cannedJson } from "@/lib/ai/canned";
import type { AiRequest } from "@/lib/ai/engine";
import { BadStructuredOutput, EngineError, UsageLimitReached } from "@/lib/ai/errors";
import { FakeEngine } from "@/lib/ai/fake-engine";
import { submitRequest, getDocument } from "@/lib/agents/requests";
import { gatherCourse, quickSearchLine, roundRobin } from "@/lib/brain/ask";
import { nextBrainFile, readingRank } from "@/lib/brain/queue";
import { badNumbers, partsOf, readIntoBrain } from "@/lib/brain/read";
import { namedFiles, namedWeeks } from "@/lib/brain/scope";
import { brainStatus, nameKey, weeksPhrase } from "@/lib/brain/store";
import { openDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { brainStep, sleptBetween, stopBackground, writingStatus } from "@/lib/layers/background";
import { approvePlan, passagesByWeek, proposeStructure } from "@/lib/layers/service";
import { addFile, analyzeProject, createProject } from "@/lib/projects/service";
import { getTalk, talk } from "@/lib/talk/service";
import { commitFiles } from "@/lib/updates/service";

let db: Db;
beforeEach(() => {
  db = openDb(":memory:").db;
});
afterEach(() => {
  stopBackground();
  vi.useRealTimers();
});

const enc = (t: string) => new TextEncoder().encode(t);
let seed = 0;
const filler = (n: number) => Array.from({ length: n }, () => `zq${++seed}x`).join(" ");
/** A paragraph of filler with one sentence about `about` in the middle, so each named thing sits in known passages. */
const para = (about: string) => `${filler(40)} ${about} ${filler(40)}`;

/** What each made-up thing is: the notes a careful reader would write. "child levy" is another name for the Devsirme, and each says so. */
const THINGS: Record<string, { kind: "concept" | "event" | "person"; aliases?: string[]; related?: string[] }> = {
  Devşirme: { kind: "concept", aliases: ["child levy"], related: ["Janissary corps"] },
  "child levy": { kind: "concept", aliases: ["devşirme"] },
  "Janissary corps": { kind: "concept" },
  "Orlen Pact": { kind: "event" },
  "Harbour Tax": { kind: "concept" },
  "Mira Tavi": { kind: "person" },
  "Salt Crisis": { kind: "event" },
};

/** Plays the brain: for every thing a passage names, a note pointing at those passages, plus the reading note. `extra` adds bad numbers. */
function brainAnswer(req: AiRequest, extra: number[] = []) {
  const passages = [...req.prompt.matchAll(/^#(\d+) \[([^\]\n]+), p\. \d+\]\n([^\n]*)/gm)].map((m) => ({ n: Number(m[1]), file: m[2], text: m[3] }));
  type Out = { name: string; kind: string; aliases: string[]; what: string; why: string; passages: number[]; related: string[] };
  const notes: Out[] = [{ name: `${passages[0].file} reading`, kind: "reading", aliases: [], what: `The argument of ${passages[0].file}, in three steps.`, why: "It is the reading.", passages: [1], related: [] }];
  for (const [name, t] of Object.entries(THINGS)) {
    const at = passages.filter((p) => p.text.includes(name)).map((p) => p.n);
    if (at.length) notes.push({ name, kind: t.kind, aliases: t.aliases ?? [], what: `${name} is a made-up thing this course names. It matters to the argument.`, why: `The reading turns on ${name}.`, passages: [...at, ...extra], related: t.related ?? [] });
  }
  return { notes };
}

/** Three weeks, one reading each; Week 1 names the Devsirme and the Janissary corps together, Week 2 the child levy, Week 3 a crisis. */
async function brainCourse() {
  const id = createProject(db, { name: "HIS200 Empire" });
  const files: [string, string][] = [
    ["HIS200/Week 1/Varnel.txt", [para("The Devşirme took boys into service, and the Janissary corps was built from them."), para("The Orlen Pact ended the war."), para(filler(30)), para("Mira Tavi wrote about the Orlen Pact.")].join("\n\n")],
    ["HIS200/Week 2/Quill.txt", [para("Villages hid their sons from the child levy."), para("The Harbour Tax paid for the fleet."), para(filler(30))].join("\n\n")],
    ["HIS200/Week 3/Hesk.txt", [para("The Salt Crisis broke the treasury."), para("After the Salt Crisis the Harbour Tax doubled."), para(filler(30))].join("\n\n")],
  ];
  for (const [relPath, text] of files) await addFile(db, id, { name: relPath.split("/").pop()!, relPath, bytes: enc(text) });
  await analyzeProject(db, cannedEngine(), id);
  return id;
}
const fileId = (projectId: string, name: string) => db.select().from(s.files).where(and(eq(s.files.projectId, projectId), eq(s.files.name, name))).get()!.id;
const brainEngine = (onRead?: (req: AiRequest) => unknown) => new FakeEngine({ json: (req: AiRequest) => (req.system.includes("You are a professor preparing to teach") ? (onRead?.(req) ?? brainAnswer(req)) : cannedJson(req)), text: "Answer." });
const noteNamed = (projectId: string, name: string) => db.select().from(s.brainNotes).where(and(eq(s.brainNotes.projectId, projectId), eq(s.brainNotes.name, name))).get();
const mentionsOf = (noteId: string) => db.select().from(s.brainMentions).where(eq(s.brainMentions.noteId, noteId)).all();
async function readAll(projectId: string, engine = brainEngine()) {
  for (const f of ["Varnel.txt", "Quill.txt", "Hesk.txt"]) await readIntoBrain(db, engine, fileId(projectId, f));
}

describe("small pure parts", () => {
  it("matches names without accents, case, a leading 'the' or punctuation", () => {
    expect(nameKey("The Devşirme")).toBe("devsirme");
    expect(nameKey("Orlen Pact (1821)")).toBe("orlen pact 1821");
  });
  it("says weeks in as few words as possible", () => {
    expect(weeksPhrase([3])).toBe("Week 3");
    expect(weeksPhrase([1, 2, 3, 4])).toBe("Weeks 1-4");
    expect(weeksPhrase([1, 2, 4, 7, 8])).toBe("Weeks 1-2, 4 and 7-8");
    expect(quickSearchLine([9])).toBe("I haven't finished reading Week 9 yet, so this comes from a quick search.");
  });
  it("cuts a long file into parts of about 30,000 words", () => {
    const ps = Array.from({ length: 10 }, () => ({ text: filler(8_000) }));
    expect(partsOf(ps).map((p) => p.length)).toEqual([3, 3, 3, 1]);
  });
  it("hears every picked note in turn before a second passage of any", () => {
    expect(roundRobin([["a1", "a2", "a3"], ["b1"], ["c1", "c2"]], 5)).toEqual(["a1", "b1", "c1", "a2", "c2"]);
  });
  it("reads the weeks and the readings a note names", () => {
    expect(namedWeeks("a concept sheet for week 2")).toEqual([2]);
    expect(namedWeeks("compare weeks 2-4 and class five")).toEqual([2, 3, 4, 5]);
    expect(namedWeeks("what happened in the weekend")).toEqual([]);
    const files = [{ id: "a", name: "Wk 02 - Clogg - Chapter 2 - Ottoman Rule.pdf" }, { id: "b", name: "Wk 04 - Clogg - Chapter 3 - Nation Building.pdf" }, { id: "c", name: "Wk 02 - Gallant - The Greek World.pdf" }, { id: "d", name: "Wk 03 - Kalyvas - pp. 25-36.pdf" }];
    expect(namedFiles("summarise Clogg chapter 3", files)).toEqual(["b"]);
    expect(namedFiles("a study guide on Clogg", files)).toEqual(["a", "b"]);
    expect(namedFiles("a concept sheet for week 2", files)).toEqual([]);
  });
});

describe("reading a file into the brain", () => {
  it("sends every passage, numbered, to the brain model, and keeps only real passages, mapped to the file and page", async () => {
    const id = await brainCourse();
    const engine = brainEngine((req) => brainAnswer(req, [99]));
    await readIntoBrain(db, engine, fileId(id, "Varnel.txt"));
    const calls = engine.calls.filter((c) => c.system.includes("You are a professor preparing to teach"));
    expect(calls[0]).toMatchObject({ model: "sonnet", task: "brain" });
    expect(calls[0].prompt).toContain("#1 [Varnel.txt, p. 1]");
    // a number that points at nothing is sent back once, then dropped
    expect(calls).toHaveLength(2);
    expect(calls[1].prompt).toContain("points at passage 99, but only 1 to");
    const note = noteNamed(id, "Orlen Pact")!;
    const places = mentionsOf(note.id);
    const passages = db.select().from(s.passages).where(eq(s.passages.fileId, fileId(id, "Varnel.txt"))).all();
    expect(places[0].passageIds.every((p) => passages.some((x) => x.id === p))).toBe(true);
    expect(places[0].passageIds.every((p) => passages.find((x) => x.id === p)!.text.includes("Orlen Pact"))).toBe(true);
    expect(db.select().from(s.brainReads).where(eq(s.brainReads.fileId, fileId(id, "Varnel.txt"))).get()).toMatchObject({ status: "read" });
  });

  it("names bad numbers in words the model can act on", () => {
    expect(badNumbers({ notes: [{ name: "X", kind: "concept", aliases: [], what: "A thing that is.", why: "Because.", passages: [2, 0, 9], related: [] }] }, 5)).toEqual(['"X" points at passages 0, 9, but only 1 to 5 were sent.']);
  });

  it("marks a file it can't read (the answer never fits) so the queue moves on, and stops for the usage limit", async () => {
    const id = await brainCourse();
    await readIntoBrain(db, new FakeEngine({ json: () => {
      throw new BadStructuredOutput("not a list");
    } }), fileId(id, "Varnel.txt"));
    expect(db.select().from(s.brainReads).where(eq(s.brainReads.fileId, fileId(id, "Varnel.txt"))).get()).toMatchObject({ status: "failed" });
    const limit = new FakeEngine({ json: () => {
      throw new UsageLimitReached(new Date(Date.now() + 3600_000));
    } });
    await expect(readIntoBrain(db, limit, fileId(id, "Quill.txt"))).rejects.toBeInstanceOf(UsageLimitReached);
    expect(db.select().from(s.brainReads).where(eq(s.brainReads.fileId, fileId(id, "Quill.txt"))).get()).toBeUndefined();
  });
});

describe("merging and linking notes", () => {
  it("merges notes about the same thing across files and weeks into one note listing every place", async () => {
    const id = await brainCourse();
    await readAll(id);
    // the Devsirme (Week 1) and the child levy (Week 2) are one note
    const dev = noteNamed(id, "Devşirme")!;
    expect(noteNamed(id, "child levy")).toBeUndefined();
    expect(dev.aliases).toContain("child levy");
    expect(mentionsOf(dev.id).map((m) => m.fileId).sort()).toEqual([fileId(id, "Varnel.txt"), fileId(id, "Quill.txt")].sort());
    // the Harbour Tax appears in Weeks 2 and 3
    expect(mentionsOf(noteNamed(id, "Harbour Tax")!.id)).toHaveLength(2);
    // every reading keeps its own note
    expect(db.select().from(s.brainNotes).where(and(eq(s.brainNotes.projectId, id), eq(s.brainNotes.kind, "reading"))).all()).toHaveLength(3);
  });

  it("links notes that appear together or that a reading names as related", async () => {
    const id = await brainCourse();
    await readAll(id);
    const links = (name: string) => {
      const n = noteNamed(id, name)!;
      return db.select({ other: s.brainNotes.name, why: s.brainLinks.why }).from(s.brainLinks).innerJoin(s.brainNotes, eq(s.brainNotes.id, s.brainLinks.otherId)).where(eq(s.brainLinks.noteId, n.id)).all();
    };
    expect(links("Devşirme")).toContainEqual({ other: "Janissary corps", why: "named" });
    expect(links("Salt Crisis").map((l) => l.other)).toContain("Harbour Tax"); // the same passage
    expect(links("Orlen Pact").map((l) => l.other)).toContain("Mira Tavi");
  });

  it("re-reading a file replaces its notes; removing a file removes its places, and notes left with none", async () => {
    const id = await brainCourse();
    await readAll(id);
    await readIntoBrain(db, brainEngine(), fileId(id, "Quill.txt"));
    expect(mentionsOf(noteNamed(id, "Devşirme")!.id)).toHaveLength(2);
    commitFiles(db, id, { staged: [], removals: [{ fileId: fileId(id, "Hesk.txt"), keep: false }] });
    expect(noteNamed(id, "Salt Crisis")).toBeUndefined();
    expect(mentionsOf(noteNamed(id, "Harbour Tax")!.id)).toHaveLength(1);
    expect(brainStatus(db, id)).toMatchObject({ filesTotal: 2, filesRead: 2, building: false });
  });
});

describe("the reading queue", () => {
  it("reads the current week first, then the next, then the rest in week order", () => {
    const files = [1, 2, 3, 4, 5].map((w) => ({ id: `f${w}`, name: `w${w}`, weeks: [w] }));
    expect(readingRank(files, 3)).toEqual(["f3", "f4", "f1", "f2", "f5"]);
  });

  it("starts right after import, before the plan is approved, and counts the weeks read", async () => {
    const id = await brainCourse();
    expect(db.select().from(s.projects).where(eq(s.projects.id, id)).get()!.status).toBe("building");
    expect(nextBrainFile(db)?.projectId).toBe(id);
    expect(brainStatus(db, id)).toMatchObject({ weeksTotal: 3, weeksRead: 0, building: true });
    await readIntoBrain(db, brainEngine(), fileId(id, "Varnel.txt"));
    expect(brainStatus(db, id)).toMatchObject({ weeksRead: 1, readWeeks: [1], unreadWeeks: [2, 3] });
    expect(writingStatus(db, id).brain.weeksRead).toBe(1);
  });

  it("an existing course gets its brain built once, without importing again", async () => {
    const id = await brainCourse();
    await proposeStructure(db, cannedEngine(), id);
    approvePlan(db, id);
    let steps = 0;
    while (await brainStep(db, brainEngine())) steps++;
    expect(steps).toBe(3);
    expect(brainStatus(db, id).building).toBe(false);
    expect(await brainStep(db, brainEngine())).toBe(false);
  });
});

describe("pausing and resuming", () => {
  it("knows the computer slept when the heartbeat comes far too late", () => {
    expect(sleptBetween(0, 10_000)).toBe(false);
    expect(sleptBetween(0, 120_000)).toBe(true);
  });

  it("picks up where it stopped: a file cut off part-way is read again, and nothing read is read twice", async () => {
    const id = await brainCourse();
    const first = brainEngine();
    await brainStep(db, first); // one file read, then Margin quits
    const readOnce = db.select().from(s.brainReads).all().map((r) => r.fileId);
    expect(readOnce).toHaveLength(1);
    stopBackground();
    const second = brainEngine();
    while (await brainStep(db, second));
    const sent = second.calls.filter((c) => c.system.includes("You are a professor preparing to teach")).map((c) => /^\[(.+?), p\. 1\]/m.exec(c.prompt.split("#1 ")[1])![1]);
    expect(sent).toHaveLength(2);
    expect(sent).not.toContain(db.select().from(s.files).where(eq(s.files.id, readOnce[0])).get()!.name);
  });

  it("a call the Mac's sleep cut off is tried again at once, not set aside", async () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
    const id = await brainCourse();
    let calls = 0;
    const engine = brainEngine((req) => {
      calls++;
      if (calls === 1) {
        vi.setSystemTime(Date.now() + 10 * 60_000); // the lid closed for ten minutes mid-call
        throw new EngineError("EngineTimeout", "Claude stopped answering.");
      }
      return brainAnswer(req);
    });
    expect(await brainStep(db, engine)).toBe(true);
    expect(db.select().from(s.brainReads).all()).toHaveLength(0); // cut off: nothing stored, not marked
    expect(await brainStep(db, engine)).toBe(true); // the same file again, straight away
    expect(db.select().from(s.brainReads).all()).toHaveLength(1);
    expect(brainStatus(db, id).filesRead).toBe(1);
  });

  it("any other failure sets the file aside for a while and moves on to the next", async () => {
    await brainCourse();
    let calls = 0;
    const engine = brainEngine((req) => {
      if (++calls === 1) throw new EngineError("EngineFailed", "Claude stopped with an error.");
      return brainAnswer(req);
    });
    await brainStep(db, engine);
    await brainStep(db, engine);
    expect(db.select().from(s.brainReads).all()).toHaveLength(1);
  });
});

/** Plays the note picker: the notes whose names `pick` lists. */
function talkEngine(pick: string[], seen: AiRequest[] = []) {
  return new FakeEngine({
    json: (req: AiRequest) => {
      seen.push(req);
      if (req.system.includes("Below is the index of your notes on it")) {
        const ids = [...req.prompt.matchAll(/^(N\d+) \| ([^|]+) \|/gm)].filter((m) => pick.includes(m[2].trim())).map((m) => m[1]);
        return { notes: ids };
      }
      return req.system.includes("You are a professor preparing to teach") ? brainAnswer(req) : cannedJson(req);
    },
    text: (req) => {
      seen.push(req);
      const cite = req.prompt.match(/\[[^\]\n]+, p\. \d+\]/)?.[0] ?? "";
      return `Here it is. ${cite}`;
    },
  });
}
const drain = async (g: AsyncGenerator<unknown>) => {
  for await (const c of g) void c;
};

describe("Let's talk! and the Note to Self chat use the brain", () => {
  it("picks notes by meaning from the index, adds linked notes, and sends their real passages with the reading notes", async () => {
    const id = await brainCourse();
    await readAll(id);
    const seen: AiRequest[] = [];
    await drain(talk(db, talkEngine(["Devşirme"], seen), id, "why did families fear the recruiters?"));
    const pick = seen.find((r) => r.system.includes("Below is the index of your notes on it"))!;
    expect(pick).toMatchObject({ model: "sonnet", task: "talk-pick" });
    expect(pick.prompt).toMatch(/\| Devşirme \| child levy \| concept \| Weeks 1-2 \|/);
    const answer = seen.find((r) => r.system.includes("You are the student's professor"))!;
    expect(answer.prompt).toContain("took boys into service"); // the Devsirme in Week 1
    expect(answer.prompt).toContain("hid their sons from the child levy"); // and in Week 2, under its other name
    expect(answer.prompt).toContain("Your notes on the readings these passages come from");
    expect(answer.prompt).toContain("The argument of Varnel.txt");
    expect(getTalk(db, id).at(-1)!.content).not.toMatch(/haven't finished reading/);
  });

  it("weeks not read yet come from a quick word search, and the answer says so in one line", async () => {
    const id = await brainCourse();
    await readIntoBrain(db, brainEngine(), fileId(id, "Varnel.txt"));
    const seen: AiRequest[] = [];
    await drain(talk(db, talkEngine([], seen), id, "what was the Salt Crisis?"));
    const answer = seen.find((r) => r.system.includes("You are the student's professor"))!;
    expect(answer.prompt).toContain("The Salt Crisis broke the treasury");
    expect(getTalk(db, id).at(-1)!.content).toMatch(/^I haven't finished reading Week 3 yet, so this comes from a quick search\.\n\nHere it is\./);
  });

  it("with nothing read yet, everything comes from the word search, as before", async () => {
    const id = await brainCourse();
    const found = await gatherCourse(db, talkEngine([]), id, { question: "Harbour Tax" });
    expect(found.passages.some((p) => p.text.includes("Harbour Tax"))).toBe(true);
    expect(found.line).toBe("I haven't finished reading Weeks 2-3 yet, so this comes from a quick search.");
  });

  it("the Note to Self chat finds its material the same way", async () => {
    const id = await brainCourse();
    await readAll(id);
    const seen: AiRequest[] = [];
    await drain(talk(db, talkEngine(["Orlen Pact"], seen), id, "remind me about the treaty", { channel: "note" }));
    const answer = seen.find((r) => r.system.includes("study partner for their Note to Self"))!;
    expect(answer.prompt).toContain("The Orlen Pact ended the war");
  });
});

describe("the agents use the same approach", () => {
  async function planned() {
    const id = await brainCourse();
    await proposeStructure(db, cannedEngine(), id);
    approvePlan(db, id);
    await readAll(id);
    return id;
  }

  it("a note naming a week gets all of that week's passages and its notes, and nothing from other weeks", async () => {
    const id = await planned();
    const seen: AiRequest[] = [];
    const r = submitRequest(db, talkEngine(["Salt Crisis"], seen), id, "a concept sheet for week 2");
    if (r.kind !== "started") throw new Error("not started");
    await r.done;
    const call = seen.find((c) => c.system.includes("The student left you a note asking for a document"))!;
    const body = call.prompt.split("## Passages: all of Week 2\n")[1].split("\n\n## ")[0];
    const week2 = passagesByWeek(db, id).get(2)!;
    for (const p of week2) expect(body).toContain(p.text);
    expect(body).not.toContain("Salt Crisis broke");
    expect(body).not.toContain("Orlen Pact");
    expect(call.prompt).toContain("## Your notes on Week 2");
    expect(call.prompt).toContain("Harbour Tax (concept)");
    expect(call.system).toContain("never pad the document with unrelated material");
    expect(getDocument(db, r.id)!.note).toBeNull();
    expect(getDocument(db, r.id)!.status).toBe("done");
  });

  it("a note naming a week the course doesn't have says so in one sentence and stops, with no AI call", async () => {
    const id = await planned();
    const engine = talkEngine([]);
    const r = submitRequest(db, engine, id, "a study guide for week 15");
    if (r.kind !== "started") throw new Error("not started");
    await r.done;
    const doc = getDocument(db, r.id)!;
    expect(doc.status).toBe("failed");
    expect(doc.note).toBe("Week 15 isn't part of this course, which has 3 weeks, so there is nothing to make this from.");
    expect(engine.calls.filter((c) => c.system.includes("The student left you a note"))).toHaveLength(0);
  });

  it("a note about a topic gets the brain's material for it", async () => {
    const id = await planned();
    const seen: AiRequest[] = [];
    const r = submitRequest(db, talkEngine(["Harbour Tax"], seen), id, "explain how the fleet was paid for");
    if (r.kind !== "started") throw new Error("not started");
    await r.done;
    const call = seen.find((c) => c.system.includes("The student left you a note asking for a document"))!;
    expect(call.prompt).toContain("The Harbour Tax paid for the fleet");
    expect(call.prompt).toContain("Harbour Tax (concept)");
  });

  it("the Librarian (no AI) finds the passages of a note the student names, or of the week named", async () => {
    const id = await planned();
    const r = submitRequest(db, talkEngine([]), id, "find passages about the child levy");
    if (r.kind !== "started") throw new Error("not started");
    await r.done;
    const text = getDocument(db, r.id)!.blocks.map((b) => ("text" in b ? b.text : "")).join("\n");
    expect(text).toContain("took boys into service"); // the Devsirme's passages, found through its other name
    expect(text).toContain("hid their sons");
  });
});
