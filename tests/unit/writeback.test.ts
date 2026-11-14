// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { cannedJson } from "@/lib/ai/canned";
import { FakeEngine } from "@/lib/ai/fake-engine";
import { openDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { getNoteGuide, getNoteToSelf } from "@/lib/layers/note-to-self";
import { getStructure } from "@/lib/layers/service";
import { dontGetIt, dontGetItSynthesis, getSynthesisThread, getThread, saveSynthesis, saveWriteback, submitSynthesis, submitWriteback } from "@/lib/layers/writeback";
import { makeApprovedProject } from "./helpers/course";

let db: Db;
let layers: string[];
const engine = (json: (r: never) => unknown = cannedJson as never) => new FakeEngine({ json, text: "Simpler: start from the idea underneath." });
const stateOf = (id: string) => getStructure(db, getStructureProject())!.parts.flatMap((p) => p.layers).find((l) => l.id === id)!.state;
let projectId = "";
const getStructureProject = () => projectId;

beforeEach(async () => {
  db = openDb(":memory:").db;
  const p = await makeApprovedProject(db);
  projectId = p.id;
  layers = p.layers().map((l) => l.id);
});

const review = (over: Record<string, unknown> = {}) => (r: { prompt: string }) => {
  const writing = r.prompt.split("## The student's write-back\n")[1]?.trim() ?? "x";
  return { fixes: [{ kind: "missing", text: "Name the term." }], cleanedUp: writing, soWhat: "It matters for the larger argument.", verdict: "needs_work", ...over };
};

describe("the write-back loop", () => {
  it("a submit alone saves nothing: the layer stays not saved until the student answers the question", async () => {
    expect(stateOf(layers[0])).toBe("not_saved");
    await submitWriteback(db, engine(review() as never), layers[0], "My first try at the layer.");
    expect(stateOf(layers[0])).toBe("not_saved");
    expect(getNoteToSelf(db, projectId).flatMap((p) => p.layers)).toEqual([]);
  });

  it("reply always has fixes, a cleaned-up version, one so-what and a verdict, and is saved to the layer's history", async () => {
    const r = await submitWriteback(db, engine(review() as never), layers[0], "My first try at the layer.");
    expect(r.review.fixes.length).toBeGreaterThan(0);
    expect(r.review.cleanedUp).toBe("My first try at the layer.");
    expect(r.review.soWhat).toMatch(/\.$/);
    expect(r.thread.messages.map((m) => [m.role, m.kind])).toEqual([["user", "writeback"], ["assistant", "review"]]);
    expect(r.thread.messages[1].review?.verdict).toBe("needs_work");
    expect(r.thread.messages[1].saveChoice).toBeNull();
  });

  it("the verdict is for information only: even APPROVED saves nothing by itself", async () => {
    await submitWriteback(db, engine(review({ fixes: [], verdict: "approved" }) as never), layers[0], "A clear write-back.");
    expect(stateOf(layers[0])).toBe("not_saved");
    expect(getThread(db, layers[0]).saved).toBeNull();
  });

  it("\"Yes, my own writing\" saves the text exactly as submitted, labelled own", async () => {
    const r = await submitWriteback(db, engine(review({ cleanedUp: "CLEANED kw1q" }) as never), layers[0], "MINE kw1q");
    const t = saveWriteback(db, layers[0], r.writebackId, "own");
    expect(t.saved).toMatchObject({ version: "own", text: "MINE kw1q", writebackId: r.writebackId });
    expect(t.messages[1].saveChoice).toBe("own");
    expect(stateOf(layers[0])).toBe("saved");
  });

  it("\"Yes, refined version\" saves the cleaned-up text, labelled refined", async () => {
    const r = await submitWriteback(db, engine(review({ cleanedUp: "MINE kw1q, fixed" }) as never), layers[0], "MINE kw1q");
    expect(saveWriteback(db, layers[0], r.writebackId, "refined").saved).toMatchObject({ version: "refined", text: "MINE kw1q, fixed" });
  });

  it("\"No\" saves nothing, and leaves an earlier save alone", async () => {
    const e = engine(review() as never);
    const first = await submitWriteback(db, e, layers[0], "First try.");
    saveWriteback(db, layers[0], first.writebackId, "own");
    const second = await submitWriteback(db, e, layers[0], "Second try.");
    const t = saveWriteback(db, layers[0], second.writebackId, "no");
    expect(t.messages.filter((m) => m.kind === "review").map((m) => m.saveChoice)).toEqual(["own", "no"]);
    expect(t.saved).toMatchObject({ version: "own", text: "First try." });
  });

  it("a newer save replaces the earlier one for that layer, and there is only ever one row", async () => {
    const e = engine(review({ cleanedUp: "Better try, fixed." }) as never);
    const first = await submitWriteback(db, e, layers[0], "First try.");
    saveWriteback(db, layers[0], first.writebackId, "own");
    const second = await submitWriteback(db, e, layers[0], "Better try.");
    expect(saveWriteback(db, layers[0], second.writebackId, "refined").saved).toMatchObject({ version: "refined", text: "Better try, fixed." });
    expect(db.select().from(s.noteSaves).all()).toHaveLength(1);
  });

  it("changing the answer on the same review switches the saved version", async () => {
    const r = await submitWriteback(db, engine(review({ cleanedUp: "Try, cleaned." }) as never), layers[0], "Try.");
    saveWriteback(db, layers[0], r.writebackId, "own");
    expect(saveWriteback(db, layers[0], r.writebackId, "refined").saved?.version).toBe("refined");
  });

  it("refuses a write-back that belongs to another layer", async () => {
    const r = await submitWriteback(db, engine(review() as never), layers[0], "First try.");
    expect(() => saveWriteback(db, layers[1], r.writebackId, "own")).toThrow(/no longer here/);
  });

  it("nothing is locked: any layer takes a submission, in any order", async () => {
    await submitWriteback(db, engine(review() as never), layers[layers.length - 1], "Starting at the end.");
    expect(stateOf(layers[0])).toBe("not_saved");
  });

  it("chat history is per layer", async () => {
    await submitWriteback(db, engine(review() as never), layers[0], "Only the first layer.");
    expect(getThread(db, layers[1]).messages).toEqual([]);
  });

  it("an empty write-back is refused before any engine call", async () => {
    const e = engine(review() as never);
    await expect(submitWriteback(db, e, layers[0], "   ")).rejects.toThrow(/Write something/);
    expect(e.calls).toHaveLength(0);
  });
});

describe("the review's grounding and citations", () => {
  it("shows the model the layer's own passages, and strips a citation that was not sent", async () => {
    const e = engine(review({ fixes: [{ kind: "fact", text: "It was 1788 [made-up.pdf, p. 99]." }] }) as never);
    const r = await submitWriteback(db, e, layers[0], "kw1q is the idea the layer opens with and develops further on.");
    expect(e.calls[0].prompt).toContain("## Course passages");
    expect(r.review.fixes[0].text).not.toContain("made-up.pdf");
    expect(r.stripped).toContain("[made-up.pdf, p. 99]");
  });

  it("retries once, stricter, when the cleaned-up version drifts from the student's own wording", async () => {
    let n = 0;
    const e = engine(((r: { prompt: string; system: string }) => {
      n++;
      const writing = r.prompt.split("## The student's write-back\n")[1].trim();
      return { fixes: [{ kind: "vague", text: "Be clearer." }], cleanedUp: n === 1 ? "Entirely different words appear here instead of yours." : writing, soWhat: "It matters for the larger argument.", verdict: "needs_work" };
    }) as never);
    const r = await submitWriteback(db, e, layers[0], "My own words about the layer and its main idea.");
    expect(e.calls).toHaveLength(2);
    expect(e.calls[1].system).toContain("at least 60%");
    expect(r.review.cleanedUp).toBe("My own words about the layer and its main idea.");
  });
});

describe("I don't get it", () => {
  it("streams a re-explanation, saves it, and never changes what is saved", async () => {
    await submitWriteback(db, engine(review() as never), layers[0], "First try.");
    let text = "";
    for await (const c of dontGetIt(db, engine(), layers[0], undefined)) if (c.type === "text") text += c.delta;
    expect(text).toContain("Simpler");
    expect(stateOf(layers[0])).toBe("not_saved");
    expect(getThread(db, layers[0]).messages.map((m) => m.kind)).toEqual(["writeback", "review", "dont_get_it", "reexplain"]);
  });

  it("goes one step more basic each time it is asked", async () => {
    const e = engine();
    for (let i = 0; i < 2; i++) for await (const _ of dontGetIt(db, e, layers[0], undefined)) void _;
    expect(e.calls[0].system).not.toContain("attempt 2");
    expect(e.calls[1].system).toContain("attempt 2");
  });
});

describe("Note to Self holds only what was sent", () => {
  it("has the chosen versions, labelled, and never a draft, a chat message or the version that was not chosen", async () => {
    const e = engine(review({ cleanedUp: "CLEANED-UP-VERSION kw1q" }) as never);
    await submitWriteback(db, e, layers[0], "DRAFT-ONE kw1q");
    const mine = await submitWriteback(db, e, layers[0], "FINAL-ONE kw1q");
    saveWriteback(db, layers[0], mine.writebackId, "own");
    const two = await submitWriteback(db, e, layers[1], "DRAFT-TWO kw1q");
    saveWriteback(db, layers[1], two.writebackId, "refined");
    const note = getNoteToSelf(db, projectId);
    const all = JSON.stringify(note);
    expect(note.flatMap((p) => p.layers).map((l) => [l.text, l.version])).toEqual([["FINAL-ONE kw1q", "own"], ["CLEANED-UP-VERSION kw1q", "refined"]]);
    expect(all).not.toContain("DRAFT-ONE");
    expect(all).not.toContain("DRAFT-TWO");
    expect(all).not.toContain("Name the term");
  });
});

describe("the Part synthesis: the same loop", () => {
  const partA = () => getStructure(db, projectId)!.parts.find((p) => p.key === "A")!;
  const synthState = () => partA().synthesis;
  const synthReview = (over: Record<string, unknown> = {}) => (r: { prompt: string; system: string }) => {
    const writing = r.prompt.split("## The student's synthesis\n")[1]?.trim() ?? "x";
    return { fixes: [{ kind: "missing", text: "Link the second layer to the first." }], cleanedUp: writing, soWhat: "The Part is one argument.", verdict: "needs_work", ...over };
  };

  it("not saved until the student answers; then the chosen version is saved and replaced by a later one", async () => {
    expect(synthState()).toBe("not_saved");
    const first = await submitSynthesis(db, engine(synthReview({ cleanedUp: "Fixed first." }) as never), partA().id, "The layers fit together because each builds on the last.");
    expect(synthState()).toBe("not_saved");
    saveSynthesis(db, partA().id, first.writebackId, "own");
    expect(synthState()).toBe("saved");
    const second = await submitSynthesis(db, engine(synthReview({ fixes: [], verdict: "approved", cleanedUp: "Revised and fixed." }) as never), partA().id, "Revised: the layers build one argument.");
    expect(synthState()).toBe("saved");
    expect(saveSynthesis(db, partA().id, second.writebackId, "refined").saved).toMatchObject({ version: "refined", text: "Revised and fixed." });
  });

  it("is reviewed with the synthesis prompt, the Part's layers, the layer writing I sent and passages from every layer", async () => {
    const e = engine(review({ fixes: [], verdict: "approved" }) as never);
    const w = await submitWriteback(db, e, layers[0], "MY-LAYER-FINAL kq2 for the first layer.");
    saveWriteback(db, layers[0], w.writebackId, "own");
    const s = engine(synthReview() as never);
    await submitSynthesis(db, s, partA().id, "How the layers connect.");
    const call = s.calls[0];
    expect(call.system).toContain("synthesis of a whole Part");
    expect(call.prompt).toContain("MY-LAYER-FINAL kq2");
    expect(call.prompt).toContain("(the student has not saved this layer yet)");
    for (const l of partA().layers) expect(call.prompt).toContain(l.title);
    const files = new Set(partA().layers.flatMap((l) => l.sources.map((x) => x.file)));
    for (const f of files) expect(call.prompt).toContain(f);
  });

  it("saving a synthesis makes no engine call, and it lands in Note to Self under its Part with its label", async () => {
    const e = engine(synthReview() as never);
    const r = await submitSynthesis(db, e, partA().id, "SYNTH-DRAFT kq3");
    const calls = e.calls.length;
    saveSynthesis(db, partA().id, r.writebackId, "own");
    expect(e.calls.length).toBe(calls);
    expect(synthState()).toBe("saved");
    const a = getNoteToSelf(db, projectId).find((p) => p.key === "A")!;
    expect(a.synthesis).toMatchObject({ kind: "part", version: "own", text: "SYNTH-DRAFT kq3" });
    const guide = getNoteGuide(db, projectId)!.parts.find((p) => p.key === "A")!;
    expect(guide.synthesis.state).toBe("saved");
  });

  it("\"No\" saves nothing; I don't get it never changes the state", async () => {
    const r = await submitSynthesis(db, engine(synthReview() as never), partA().id, "Not for the notes.");
    saveSynthesis(db, partA().id, r.writebackId, "no");
    expect(synthState()).toBe("not_saved");
    for await (const _ of dontGetItSynthesis(db, engine(), partA().id, undefined)) void _;
    expect(synthState()).toBe("not_saved");
    expect(getSynthesisThread(db, partA().id).messages.map((m) => m.kind)).toEqual(["writeback", "review", "dont_get_it", "reexplain"]);
  });

  it("is never locked by unfinished layers, and the layer and synthesis histories stay apart", async () => {
    await submitSynthesis(db, engine(synthReview() as never), partA().id, "Written before any layer is done.");
    expect(partA().progress.saved).toBe(0);
    expect(getThread(db, layers[0]).messages).toEqual([]);
    expect(partA().progress.total).toBe(partA().layers.length); // the synthesis counts separately
  });
});
