// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cannedEngine, cannedJson, cannedText } from "@/lib/ai/canned";
import type { AiRequest } from "@/lib/ai/engine";
import { ClaudeBusy, EngineError, EngineTimeout, UsageLimitReached } from "@/lib/ai/errors";
import { FakeEngine } from "@/lib/ai/fake-engine";
import { writeExplained } from "@/lib/ai/tasks";
import { openDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { EXPLAINED_MIN, WEEK_EXPLAINED, explainedBudget, explainedWords } from "@/lib/layers/explained-length";
import { watchProgress, type LayerProgress } from "@/lib/layers/layer-progress";
import { approvePlan, getLayer, getStructure, layerIdleMs, proposeStructure, writeLayerContent } from "@/lib/layers/service";
import { addFile, analyzeProject, createProject } from "@/lib/projects/service";
import { longReading } from "../fixtures/long-reading";

// ----------------------------------------------------------------------------- how long Explained may be

describe("the Explained word budget", () => {
  it("is about 4,000 words a week, shared between its layers by how much source text each has", () => {
    expect(explainedBudget(5_000, 10_000)).toEqual({ target: 2_000, max: 2_500, min: 1_200 });
    expect(explainedBudget(2_500, 10_000)).toEqual({ target: 1_000, max: 1_250, min: 600 });
    expect(explainedBudget(10_000, 10_000).target).toBe(WEEK_EXPLAINED);
    // a sliver of a heavy week still gets enough room to teach
    expect(explainedBudget(300, 30_000).target).toBe(EXPLAINED_MIN);
    // the layers of a week add up to about 4,000
    const layers = [8_000, 6_000, 6_000];
    const total = layers.reduce((a, b) => a + b, 0);
    expect(layers.reduce((n, w) => n + explainedBudget(w, total).target, 0)).toBe(4_000);
  });

  it("counts the whole explanation without the citations", () => {
    const e = {
      version: 2,
      question: "Q?",
      summary: "One two three.",
      sections: [{ question: "Four five?", blocks: [{ type: "paragraph", text: "Six seven. [Reading 1.txt, p. 12]" }, { type: "bullets", items: ["eight [a.pdf, pp. 3–4]"] }] }],
      soWhat: "Nine.",
    } as any;
    expect(explainedWords(e)).toBe(9);
    // an Explained written before the new shape is still counted
    expect(explainedWords({ summary: "One two.", blocks: [{ type: "heading", text: "Three" }, { type: "paragraph", text: "Four [a.txt, p. 1]" }], soWhat: "Five." } as any)).toBe(5);
  });

  it("an answer far from its share has only some sections written again, never the whole Explained", async () => {
    const text = (body: string) => `# Summary\nThe gist of the layer in two plain sentences. Then a little more.\n\n## What is it?\n${body} [a.txt, p. 1]\n\n## Why does it matter?\nBecause it carries the argument forward. [a.txt, p. 1]\n\n# So what\nIt matters for the next layer.`;
    const input = { course: "C", week: { label: "Week 1", syllabus: null }, layer: { title: "T", bigQuestion: "Q?" }, passages: [{ file: "a.txt", page: 1, text: "x" }], notes: [], length: { target: 500, max: 600, min: 300 } };
    const fixer = (r: AiRequest) => (r.system.includes("You fix one section") ? `## What is it?\n\n${"word ".repeat(400)}[a.txt, p. 1]` : text("word ".repeat(900)));
    const engine = new FakeEngine({ text: fixer });
    const out = await writeExplained(engine, input);
    expect(engine.calls).toHaveLength(2);
    expect(engine.calls[1].system).toMatch(/You fix one section/);
    expect(engine.calls[1].prompt).toMatch(/The whole explanation is 9\d\d words and may be at most 600/);
    expect(explainedWords({ ...out.explained, version: 2, question: "" })).toBeLessThanOrEqual(600);
    // far too short: the shortest section grows
    const thin = new FakeEngine({ text: (r: AiRequest) => (r.system.includes("You fix one section") ? "## What is it?\n\nLonger. [a.txt, p. 1]" : text("Short.")) });
    await writeExplained(thin, input);
    expect(thin.calls[1].prompt).toMatch(/should be about 500, so this section should grow/);
    // within its share: no second call
    const ok = new FakeEngine({ text: text("word ".repeat(420)) });
    await writeExplained(ok, input);
    expect(ok.calls).toHaveLength(1);
  });
});

// ----------------------------------------------------------------------------- writing a layer: speed, progress and failures

const enc = (t: string) => new TextEncoder().encode(t);
let db: Db;
let projectId: string;

beforeAll(() => {
  process.env.MARGIN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "margin-layer-writing-"));
});
beforeEach(async () => {
  db = openDb(":memory:").db;
  projectId = createProject(db, { name: "PERF101 Long readings" });
  // made-up text only: two weeks, one of them a long reading
  await addFile(db, projectId, { name: "The Arden Papers.txt", relPath: "Week 1/The Arden Papers.txt", bytes: enc(longReading({ words: 12_000 })) });
  await addFile(db, projectId, { name: "Short.txt", relPath: "Week 2/Short.txt", bytes: enc(longReading({ words: 2_500, seed: 2 })) });
  await analyzeProject(db, cannedEngine(), projectId);
  await proposeStructure(db, cannedEngine(), projectId);
  approvePlan(db, projectId);
});

const firstLayer = () => getStructure(db, projectId)!.weeks[0].layers[0].id;
const rename = (id: string, title: string) => db.update(s.layers).set({ title }).where(eq(s.layers.id, id)).run();
const draftOf = (id: string) => db.select().from(s.uiState).where(and(eq(s.uiState.projectId, projectId), eq(s.uiState.key, `layer-draft:${id}`))).get();
const isPick = (r: AiRequest) => r.system.includes("You choose the source passages");
const isExplain = (r: AiRequest) => r.system.includes('write the "Explained" tab');

describe("writing a layer", () => {
  it("picks the Source and writes Explained side by side, Explained from all the layer's passages and held to its budget", async () => {
    const id = firstLayer();
    let running = 0;
    let most = 0;
    const engine = new FakeEngine({ json: cannedJson, text: cannedText, delayMs: 2 });
    const json = engine.json.bind(engine);
    engine.json = (async (...args: Parameters<typeof json>) => {
      most = Math.max(most, ++running);
      try {
        return await json(...args);
      } finally {
        running--;
      }
    }) as typeof engine.json;
    const stream = engine.stream.bind(engine);
    engine.stream = async function* (...args: Parameters<typeof stream>) {
      most = Math.max(most, ++running);
      try {
        yield* stream(...args);
      } finally {
        running--;
      }
    };
    await writeLayerContent(db, engine, id);
    expect(most).toBe(2);
    const explain = engine.calls.find(isExplain)!;
    const layerPassages = db.select().from(s.layerPassages).where(eq(s.layerPassages.layerId, id)).all().length;
    expect((explain.prompt.match(/^\[The Arden Papers\.txt, p\. \d+\]$/gm) ?? []).length).toBe(layerPassages);
    expect(explain.system).toMatch(/run to about \d+ words, never more than \d+/);
    expect(explain.task).toBe("explain");
    expect(engine.calls.find(isPick)!.task).toBe("source");
    expect(getLayer(db, id)!.contentStatus).toBe("ready");
  });

  it("reports each step as it goes and the explanation's text as it is written, then ends done", async () => {
    const id = firstLayer();
    const seen: LayerProgress[] = [];
    const job = writeLayerContent(db, new FakeEngine({ json: cannedJson, text: cannedText, delayMs: 20 }), id);
    watchProgress(id, (p) => seen.push(structuredClone(p)));
    await job;
    expect(seen[0].steps.source).toBe("working");
    expect(seen[0].steps.explained).toBe("working");
    // the text grows while it is written: the page shows the first section before the last is written
    const texts = seen.map((p) => p.text).filter(Boolean);
    expect(texts.length).toBeGreaterThan(2);
    expect(texts[0].length).toBeLessThan(texts.at(-1)!.length);
    expect(texts.some((t) => t.includes("## What is step 1") && !t.includes("# So what"))).toBe(true);
    expect(seen.some((p) => p.steps.check === "working")).toBe(true);
    expect(seen.at(-1)!.outcome).toEqual({ ok: true });
    expect(seen.at(-1)!.steps).toEqual({ source: "done", explained: "done", check: "done" });
  });

  it("the usage limit: a clear message with the reset time, both calls stopped, the layer left ready to try again", async () => {
    const id = firstLayer();
    rename(id, "Arden (fake: usage limit)");
    const outcome: LayerProgress["outcome"][] = [];
    const job = writeLayerContent(db, cannedEngine(), id);
    watchProgress(id, (p) => outcome.push(p.outcome));
    const e = await job.catch((x) => x);
    expect(e).toBeInstanceOf(UsageLimitReached);
    expect(e.message).toMatch(/^Your Claude plan's usage limit has been reached\. It resets at .+\. Wait for it to reset, then try again\.$/);
    expect(outcome.at(-1)).toMatchObject({ ok: false, code: "UsageLimitReached" });
    expect(getLayer(db, id)!.contentStatus).toBe("none");
    rename(id, "Arden");
    await writeLayerContent(db, cannedEngine(), id);
    expect(getLayer(db, id)!.contentStatus).toBe("ready");
  });

  it("an error or a busy Claude says so plainly, and nothing is left spinning", async () => {
    const id = firstLayer();
    rename(id, "Arden (fake: error)");
    const e = await writeLayerContent(db, cannedEngine(), id).catch((x) => x);
    expect(e).toBeInstanceOf(EngineError);
    expect(e.message).toMatch(/^Claude stopped with an error: API Error: 500/);
    expect(getLayer(db, id)!.contentStatus).toBe("none");
    rename(id, "Arden (fake: busy)");
    expect(await writeLayerContent(db, cannedEngine(), id).catch((x) => x)).toBeInstanceOf(ClaudeBusy);
  });

  it("stops only when nothing new arrives for its quiet limit, says so, and stops the calls", async () => {
    const id = firstLayer();
    rename(id, "Arden (fake: hang)");
    const started = Date.now();
    const e = await writeLayerContent(db, cannedEngine(), id, { idleMs: 200 }).catch((x) => x);
    expect(e).toBeInstanceOf(EngineTimeout);
    expect(e.message).toMatch(/^Nothing new came from Claude for \d+ seconds, so Margin stopped waiting\. Try again; anything already finished is kept\.$/);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(getLayer(db, id)!.contentStatus).toBe("none");
  });

  it("a slow layer that keeps writing is never stopped, however long it takes in all", async () => {
    const id = firstLayer();
    // about 40 words at 25 ms each: past a 150 ms quiet limit in all, but never quiet for that long
    const short = "# Summary\nThe gist of the layer in plain words.\n\n## What is it?\nIt is the first idea. [The Arden Papers.txt, p. 1]\n\n## Why does it matter?\nIt carries the argument. [The Arden Papers.txt, p. 1]\n\n# So what\nIt matters for the next layer.";
    const fix = "## What is it?\n\nIt is the first idea, explained again. [The Arden Papers.txt, p. 1]";
    const started = Date.now();
    await writeLayerContent(db, new FakeEngine({ json: cannedJson, text: (r: AiRequest) => (r.system.includes("You fix one section") ? fix : short), delayMs: 25 }), id, { idleMs: 150 });
    expect(Date.now() - started).toBeGreaterThan(150);
    expect(getLayer(db, id)!.contentStatus).toBe("ready");
  });

  it("anything already finished is kept: Try again only writes what is missing", async () => {
    const id = firstLayer();
    let explainFails = true;
    const flaky = new FakeEngine({
      json: cannedJson,
      text: (r: AiRequest) => {
        if (isExplain(r) && explainFails) throw new EngineError("EngineFailed", "Claude stopped with an error: boom");
        return cannedText(r);
      },
    });
    const outcome: LayerProgress["outcome"][] = [];
    const job = writeLayerContent(db, flaky, id);
    watchProgress(id, (p) => outcome.push(p.outcome));
    await expect(job).rejects.toThrow("boom");
    expect(outcome.at(-1)).toMatchObject({ ok: false, kept: ["source"] });
    expect((draftOf(id)?.value as any).source.length).toBeGreaterThan(0);
    explainFails = false;
    const before = flaky.calls.length;
    await writeLayerContent(db, flaky, id);
    const again = flaky.calls.slice(before);
    expect(again).toHaveLength(1); // only Explained; the Source picks were kept
    expect(isPick(again[0])).toBe(false);
    expect(getLayer(db, id)!.content!.source.length).toBeGreaterThan(0);
    expect(draftOf(id)).toBeUndefined(); // the draft goes once the layer is saved
  });

  it("a kept draft no longer counts once the layer's passages or question change", async () => {
    const id = firstLayer();
    const broken = new FakeEngine({
      json: cannedJson,
      text: () => {
        throw new EngineError("EngineFailed", "boom");
      },
    });
    await writeLayerContent(db, broken, id).catch(() => {});
    db.update(s.layers).set({ bigQuestion: "A different question?" }).where(eq(s.layers.id, id)).run();
    const engine = cannedEngine();
    await writeLayerContent(db, engine, id);
    expect(engine.calls.filter(isPick)).toHaveLength(1);
  });

  it("stops after 3 quiet minutes by default, or MARGIN_LAYER_IDLE_S", () => {
    expect(layerIdleMs({})).toBe(180_000);
    expect(layerIdleMs({ MARGIN_LAYER_IDLE_S: "60" })).toBe(60_000);
    expect(layerIdleMs({ MARGIN_LAYER_IDLE_S: "junk" })).toBe(180_000);
  });
});
