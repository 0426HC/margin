// @vitest-environment node
/**
 * The brain's other names: only true alternative names or spellings for the same thing; related things are links. Notes merge only when
 * they are the same thing. A brain read before the rule is checked once and its wrong merges split. Claude's part is played by scripted
 * answers; the fake engine and an in-memory database only.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { cannedEngine, cannedJson } from "@/lib/ai/canned";
import type { AiRequest } from "@/lib/ai/engine";
import { FakeEngine } from "@/lib/ai/fake-engine";
import { readForBrain } from "@/lib/ai/prompts";
import { brainsToCheck, checkBrainNamesOf, entryProblems } from "@/lib/brain/names-check";
import { readIntoBrain, trueAliases } from "@/lib/brain/read";
import { rebuildLinks, sameThing } from "@/lib/brain/store";
import { openDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { addFile, analyzeProject, createProject } from "@/lib/projects/service";

let db: Db;
beforeEach(() => {
  db = openDb(":memory:").db;
});
const enc = (t: string) => new TextEncoder().encode(t);
let seed = 0;
const filler = (n: number) => Array.from({ length: n }, () => `zk${++seed}x`).join(" ");

type Note = { name: string; kind: "concept" | "person"; aliases?: string[]; related?: string[] };
const answer = (file: string, notes: Note[]) => ({
  notes: [
    { name: `${file} reading`, kind: "reading", aliases: [], what: `The argument of ${file}, in three steps.`, why: "It is the reading.", passages: [1], related: [] },
    ...notes.map((n) => ({ name: n.name, kind: n.kind, aliases: n.aliases ?? [], what: `${n.name} as this file describes it, in plain words.`, why: "It matters here.", passages: [1], related: n.related ?? [] })),
  ],
});

/** Two weeks, one made-up reading each. `answers` plays the brain for each file. */
async function course(answers: Record<string, Note[]>) {
  const id = createProject(db, { name: "HIS300 Uprising" });
  for (const [w, name] of [[1, "Ardel.txt"], [2, "Brisk.txt"]] as const) await addFile(db, id, { name, relPath: `Week ${w}/${name}`, bytes: enc(`${filler(80)}\n\n${filler(80)}`) });
  await analyzeProject(db, cannedEngine(), id);
  const engine = new FakeEngine({ json: (r: AiRequest) => (r.system.includes("You are a professor preparing to teach") ? answer(/^\[([^\]\n]+), p\./m.exec(r.prompt.split("#1 ")[1])![1], answers[/^\[([^\]\n]+), p\./m.exec(r.prompt.split("#1 ")[1])![1]] ?? []) : cannedJson(r)) });
  for (const f of db.select().from(s.files).where(eq(s.files.projectId, id)).all()) await readIntoBrain(db, engine, f.id);
  return id;
}
const notesOf = (id: string) => db.select().from(s.brainNotes).where(and(eq(s.brainNotes.projectId, id))).all().filter((n) => n.kind !== "reading");

describe("other names are only true alternative names", () => {
  it("the brain is told that related or similar things are links, never other names", () => {
    const p = readForBrain({ course: "C", file: "f.txt", week: null, kind: "a reading", passages: [{ n: 1, file: "f.txt", page: 1, text: "x" }] });
    expect(p.system).toMatch(/only true other names or spellings for exactly the same thing/);
    expect(p.system).toMatch(/Never a related, similar, broader or narrower thing, a group it belongs to, a rival, a relative, an ally or a successor: those are different things and go in "related"/);
  });

  it("Kapodistrias given 'Ipsilantis brothers' as an other name: two notes, never merged", async () => {
    const id = await course({
      "Ardel.txt": [{ name: "Kapodistrias", kind: "person", aliases: ["Ipsilantis brothers"] }],
      "Brisk.txt": [{ name: "Ipsilantis brothers", kind: "person" }],
    });
    expect(notesOf(id).map((n) => n.name).sort()).toEqual(["Ipsilantis brothers", "Kapodistrias"]);
  });

  it("klefts given 'armatoles' as an other name: two notes, in one file or across two", async () => {
    // one file names both: the other name is the name of another note, so it is dropped
    expect(trueAliases(answer("a.txt", [{ name: "Klefts", kind: "concept", aliases: ["armatoles", "kleftes"] }, { name: "Armatoles", kind: "concept" }]) as never)).toEqual([[], ["kleftes"], []]);
    const id = await course({
      "Ardel.txt": [{ name: "Klefts", kind: "concept", aliases: ["armatoles"] }],
      "Brisk.txt": [{ name: "Armatoles", kind: "concept" }],
    });
    expect(notesOf(id).map((n) => n.name).sort()).toEqual(["Armatoles", "Klefts"]);
  });

  it("an other name the note also lists as related is dropped", () => {
    expect(trueAliases(answer("a.txt", [{ name: "Klefts", kind: "concept", aliases: ["armatoles"], related: ["Armatoles"] }]) as never)[1]).toEqual([]);
  });

  it("the same thing still merges: the same name, or each naming the other (devşirme and the child levy)", async () => {
    expect(sameThing({ name: "Devşirme", aliases: ["child levy"] }, { name: "Child levy", aliases: ["devsirme"] })).toBe(true);
    expect(sameThing({ name: "The Devşirme", aliases: [] }, { name: "devsirme", aliases: [] })).toBe(true);
    expect(sameThing({ name: "Devşirme", aliases: ["child levy"] }, { name: "Child levy", aliases: [] })).toBe(false);
    const id = await course({
      "Ardel.txt": [{ name: "Devşirme", kind: "concept", aliases: ["child levy"] }],
      "Brisk.txt": [{ name: "Child levy", kind: "concept", aliases: ["devşirme"] }],
    });
    const notes = notesOf(id);
    expect(notes).toHaveLength(1);
    expect(db.select().from(s.brainMentions).where(eq(s.brainMentions.noteId, notes[0].id)).all()).toHaveLength(2);
  });
});

describe("a brain read before the rule is checked once", () => {
  /** A brain as the old rule left it: klefts and armatoles merged into one note, Kapodistrias with a loose other name. */
  async function oldBrain() {
    const id = await course({});
    const [a, b] = db.select().from(s.files).where(eq(s.files.projectId, id)).all().sort((x, y) => x.name.localeCompare(y.name));
    const note = (name: string, kind: s.BrainKind, aliases: string[]) => {
      const nid = `${name.slice(0, 4)}${++seed}`;
      db.insert(s.brainNotes).values({ id: nid, projectId: id, name, kind, aliases, what: `${name}, as first described.` }).run();
      return nid;
    };
    const mention = (noteId: string, fileId: string, what: string) => db.insert(s.brainMentions).values({ noteId, fileId, projectId: id, what, why: "It matters.", passageIds: [], related: [] }).run();
    const klefts = note("Klefts", "concept", ["armatoles"]);
    mention(klefts, a.id, "Bandits of the mountains who lived outside Ottoman law.");
    mention(klefts, b.id, "Christian militias the Ottomans paid to keep the mountain passes.");
    const kapo = note("Kapodistrias", "person", ["Ipsilantis brothers"]);
    mention(kapo, a.id, "The first governor of the new state, a former foreign minister.");
    db.insert(s.uiState).values({ id: `${id}:brain-names-check`, projectId: id, key: "brain-names-check", value: true }).run();
    rebuildLinks(db, id);
    return { id, a, b, klefts, kapo };
  }
  const checkAnswer = {
    notes: [
      { note: "N1", things: [{ name: "Kapodistrias", aliases: [], mentions: [1] }] },
      { note: "N2", things: [{ name: "Klefts", aliases: [], mentions: [1] }, { name: "armatoles", aliases: [], mentions: [2] }] },
    ],
  };
  const namesEngine = (answers: unknown[]) => {
    let n = 0;
    return new FakeEngine({ json: (r: AiRequest) => (r.system.includes("You check the notes a study app keeps") ? answers[Math.min(n++, answers.length - 1)] : cannedJson(r)) });
  };

  it("splits a wrong merge, each file's description going with its thing, and trims a loose other name", async () => {
    const { id, a, b, klefts, kapo } = await oldBrain();
    expect(brainsToCheck(db)).toEqual([id]);
    const engine = namesEngine([checkAnswer]);
    expect(await checkBrainNamesOf(db, engine, id)).toEqual({ split: 1, trimmed: 2 });
    const call = engine.calls.find((c) => c.task === "check-names")!;
    expect(call.prompt).toMatch(/N2 \| Klefts \| concept \| other names: armatoles\n {2}1\. Ardel\.txt: Bandits[^\n]*\n {2}2\. Brisk\.txt: Christian militias/);
    const kl = db.select().from(s.brainNotes).where(eq(s.brainNotes.id, klefts)).get()!;
    expect(kl).toMatchObject({ name: "Klefts", aliases: [], what: "Bandits of the mountains who lived outside Ottoman law." });
    const arm = notesOf(id).find((n) => n.name === "armatoles")!;
    expect(arm.what).toBe("Christian militias the Ottomans paid to keep the mountain passes.");
    expect(db.select().from(s.brainMentions).where(eq(s.brainMentions.noteId, klefts)).all().map((m) => m.fileId)).toEqual([a.id]);
    expect(db.select().from(s.brainMentions).where(eq(s.brainMentions.noteId, arm.id)).all().map((m) => m.fileId)).toEqual([b.id]);
    expect(db.select().from(s.brainNotes).where(eq(s.brainNotes.id, kapo)).get()!.aliases).toEqual([]);
    // checked once
    expect(brainsToCheck(db)).toEqual([]);
  });

  it("an answer that invents a name or loses a file's description is sent back once, then left as it was", async () => {
    const bad = { notes: [{ note: "N2", things: [{ name: "Klefts", aliases: [], mentions: [1] }, { name: "Hill bandits", aliases: [], mentions: [1] }] }] };
    const note = { id: "N2", name: "Klefts", kind: "concept", aliases: ["armatoles"], mentions: [{ n: 1, file: "a", what: "" }, { n: 2, file: "b", what: "" }] };
    expect(entryProblems(bad.notes[0], note).join(" ")).toMatch(/"Hill bandits" is not one of the note's names[^]*2 went nowhere; 1 went to two/);
    const { id, klefts } = await oldBrain();
    const engine = namesEngine([bad]);
    expect(await checkBrainNamesOf(db, engine, id)).toEqual({ split: 0, trimmed: 0 });
    expect(engine.calls.filter((c) => c.task === "check-names")).toHaveLength(2);
    expect(engine.calls.filter((c) => c.task === "check-names")[1].prompt).toContain("Your last answer was rejected");
    expect(db.select().from(s.brainNotes).where(eq(s.brainNotes.id, klefts)).get()!.aliases).toEqual(["armatoles"]);
    expect(brainsToCheck(db)).toEqual([]);
  });

  it("a course whose brain is read under the new rule is never marked for the check", async () => {
    await course({ "Ardel.txt": [{ name: "Klefts", kind: "concept" }] });
    expect(brainsToCheck(db)).toEqual([]);
  });
});
