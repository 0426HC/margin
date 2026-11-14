// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { FakeEngine } from "@/lib/ai/fake-engine";
import { professor } from "@/lib/ai/prompts";
import { openDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { getThread } from "@/lib/layers/writeback";
import { getTalk, talk, TALK_PASSAGES } from "@/lib/talk/service";
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

/** A word that is in exactly one passage, and where that passage is. */
const probe = (n: number) => {
  const p = db.select().from(s.passages).all()[n];
  const word = p.text.split(/\s+/).find((w) => /^kw\d+q$/.test(w))!;
  const file = db.select().from(s.files).all().find((f) => f.id === p.fileId)!.name;
  return { word, file, page: p.page };
};
const drain = async (g: AsyncGenerator<unknown>) => {
  for await (const c of g) void c;
};

describe("Let's talk!", () => {
  it("searches the whole project and sends the matching passages, with file and page, to the talk model", async () => {
    const far = probe(40); // a passage in a different file and layer from the first
    const engine = new FakeEngine({ text: "Answer." });
    await drain(talk(db, engine, projectId, `what is ${far.word}`));
    const call = engine.calls[0];
    expect(call.prompt).toContain(`[${far.file}, p. ${far.page}]`);
    expect(call.prompt).toContain(far.word);
    expect(call.model).toBe("sonnet");
    expect(call.effort).toBeUndefined();
    expect(call.prompt.match(/\n\[[^\]\n]+, p\. \d+\]\n/g)!.length).toBeLessThanOrEqual(TALK_PASSAGES);
  });

  it("saves the question and the answer, per project, in order, and survives a new read", async () => {
    await drain(talk(db, new FakeEngine({ text: "First answer." }), projectId, "first question"));
    await drain(talk(db, new FakeEngine({ text: "Second answer." }), projectId, "second question"));
    expect(getTalk(db, projectId).map((m) => [m.role, m.content])).toEqual([
      ["user", "first question"],
      ["assistant", "First answer."],
      ["user", "second question"],
      ["assistant", "Second answer."],
    ]);
  });

  it("sends earlier turns so a follow-up makes sense, and searches a short follow-up together with the question before it", async () => {
    const a = probe(5);
    await drain(talk(db, new FakeEngine({ text: "It is about the thing." }), projectId, `explain ${a.word}`));
    const engine = new FakeEngine({ text: "Because." });
    await drain(talk(db, engine, projectId, "and why?"));
    expect(engine.calls[0].prompt).toContain("Student: explain " + a.word);
    expect(engine.calls[0].prompt).toContain("Professor: It is about the thing.");
    expect(engine.calls[0].prompt).toContain(`[${a.file}, p. ${a.page}]`); // found through the earlier question
  });

  it("never mixes with a layer's chatbot, or another project's talk", async () => {
    await drain(talk(db, new FakeEngine({ text: "Hello." }), projectId, "hi there"));
    expect(getThread(db, layers[0]).messages).toHaveLength(0);
    const other = await makeApprovedProject(db, "Other course");
    expect(getTalk(db, other.id)).toEqual([]);
    expect(db.select().from(s.layerMessages).all()).toHaveLength(0);
  });

  it("strips a citation that was not in the passages sent, and keeps one that was", async () => {
    const a = probe(3);
    const text = `Real [${a.file}, p. ${a.page}] and invented [nowhere.pdf, p. 99].`;
    await drain(talk(db, new FakeEngine({ text }), projectId, `about ${a.word}`));
    const saved = getTalk(db, projectId).at(-1)!.content;
    expect(saved).toContain(`[${a.file}, p. ${a.page}]`);
    expect(saved).not.toContain("nowhere.pdf");
  });

  it("Stop keeps what had arrived", async () => {
    const ctl = new AbortController();
    const engine = new FakeEngine({ text: "one two three four five six", delayMs: 5 });
    const g = talk(db, engine, projectId, "keep going", undefined, ctl.signal);
    await g.next();
    await g.return(undefined); // the route does this when the browser disconnects
    expect(getTalk(db, projectId).map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(getTalk(db, projectId)[1].content.length).toBeGreaterThan(0);
  });

  it("says plainly when nothing matches, in the prompt", () => {
    const { prompt, system } = professor({ passages: [], history: [], question: "zzz" });
    expect(prompt).toContain("none of the course files matched");
    expect(system).toMatch(/Never invent/);
  });

  it("is refused for a project that doesn't exist, before anything is saved", async () => {
    await expect(drain(talk(db, new FakeEngine({ text: "x" }), "nope", "hi"))).rejects.toThrow(/no longer exists/);
  });
});

describe("one conversation per project, with the layer a message came from", () => {
  it("a message sent from a layer carries a subtitle with the layer's number in its Part and its title", async () => {
    const layer = db.select().from(s.layers).all().filter((l) => l.partId === db.select().from(s.layers).all().find((x) => x.id === layers[0])!.partId)[1];
    await drain(talk(db, new FakeEngine({ text: "Answer." }), projectId, "from a layer", { layerId: layer.id }));
    await drain(talk(db, new FakeEngine({ text: "Answer." }), projectId, "from the section"));
    const user = getTalk(db, projectId).filter((m) => m.role === "user");
    expect(user.map((m) => m.context)).toEqual([`From Layer 2: ${layer.title}`, null]);
  });

  it("the same history is read from every layer and from the section: there is only one thread", async () => {
    await drain(talk(db, new FakeEngine({ text: "One." }), projectId, "first", { layerId: layers[0] }));
    await drain(talk(db, new FakeEngine({ text: "Two." }), projectId, "second", { layerId: layers[layers.length - 1] }));
    expect(getTalk(db, projectId).map((m) => m.content)).toEqual(["first", "One.", "second", "Two."]);
  });

  it("a Part synthesis is named by its Part, and an unknown or foreign layer adds no subtitle", async () => {
    const part = db.select().from(s.parts).all()[0];
    await drain(talk(db, new FakeEngine({ text: "A." }), projectId, "q1", { partId: part.id }));
    await drain(talk(db, new FakeEngine({ text: "A." }), projectId, "q2", { layerId: "nope" }));
    expect(getTalk(db, projectId).filter((m) => m.role === "user").map((m) => m.context)).toEqual([`From ${part.title} synthesis`, null]);
  });
});
