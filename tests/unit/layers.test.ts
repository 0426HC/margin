// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cannedEngine, cannedJson, cannedText } from "@/lib/ai/canned";
import type { AiRequest } from "@/lib/ai/engine";
import { FakeEngine } from "@/lib/ai/fake-engine";
import { openDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { copySource } from "@/lib/layers/copy-source";
import { blocksForPassages } from "@/lib/layers/source-blocks";
import { makePassages } from "@/lib/import/passages";
import type { Block } from "@/lib/import/types";
import { readingOrder } from "@/lib/layers/reading-order";
import { GateError, StructureError, approvePlan, fallbackWeek, getLayer, getStructure, mergeWithNext, moveLayer, moveLayerToWeek, proposeStructure, splitLayer, updateLayer, writeLayerContent } from "@/lib/layers/service";
import type { OrderedPassage } from "@/lib/layers/types";
import { validateBreakdown } from "@/lib/layers/validate-breakdown";
import { MAX_LAYERS_PER_WEEK } from "@/lib/layers/week-shape";
import { addFile, analyzeProject, createProject } from "@/lib/projects/service";

const op = (n: number, words: number, unit: string, unitId = unit): OrderedPassage => ({ n, passageId: `p${n}`, sectionId: "s", unitId, unit, file: `${unit}.txt`, page: n, text: `text ${n}`, words });

describe("validateBreakdown", () => {
  const L = (...ranges: [number, number][]) => ({ ranges: ranges.map(([from, to]) => ({ from, to })) });
  it("accepts layers that cover every passage once", () => {
    expect(validateBreakdown([L([1, 3]), L([4, 4]), L([5, 6])], 6).errors).toEqual([]);
    expect(validateBreakdown([L([1, 2], [3, 3]), L([4, 5])], 5).errors).toEqual([]); // adjacent ranges in one layer
  });
  it("accepts a topic that runs through several readings: a layer with ranges from different places, in any layer order", () => {
    expect(validateBreakdown([L([1, 3], [13, 14]), L([4, 5], [15, 16]), L([6, 12], [17, 21])], 21).errors).toEqual([]);
    expect(validateBreakdown([L([4, 5]), L([1, 3])], 5).errors).toEqual([]);
  });
  it.each([
    ["a gap", [L([1, 2]), L([4, 5])], 5, /passage 3 is not in any layer/],
    ["a missing tail", [L([1, 3])], 5, /passages 4 to 5 are not in any layer/],
    ["an overlap between layers", [L([1, 3]), L([3, 5])], 5, /passage 3 is used by more than one layer/],
    ["a passage twice in one layer", [L([1, 3], [2, 4])], 4, /passages 2 to 3 are used by more than one layer/],
    ["an unknown passage", [L([1, 9])], 5, /only passages 1 to 5 exist/],
    ["passage zero", [L([0, 2])], 2, /only passages 1 to 2 exist/],
  ])("rejects %s", (_n, layers, count, message) => {
    expect(validateBreakdown(layers as any, count).errors.join(" ")).toMatch(message);
  });
});

describe("fallbackWeek: a week the AI couldn't plan", () => {
  it.each([
    ["several files", [op(1, 800, "W1"), op(2, 800, "W1"), op(3, 900, "W2"), op(4, 900, "W3")]],
    ["one file", Array.from({ length: 12 }, (_, i) => op(i + 1, 200, "W1"))],
    ["a single passage", [op(1, 200, "W1")]],
    ["seven files, more than a week may have", Array.from({ length: 7 }, (_, i) => op(i + 1, 900, `F${i}`))],
  ])("covers every passage exactly once, in at most five layers: %s", (_n, passages) => {
    const layers = fallbackWeek(passages);
    expect(validateBreakdown(layers.map((l) => ({ ranges: l.passages.map((n) => ({ from: n, to: n })) })), passages.length).errors).toEqual([]);
    expect(layers.length).toBeLessThanOrEqual(MAX_LAYERS_PER_WEEK);
    expect(layers.every((l) => l.bigQuestion.endsWith("?"))).toBe(true);
  });
  it("one layer per file", () => {
    expect(fallbackWeek([op(1, 800, "W1"), op(2, 800, "W1"), op(3, 900, "W2")]).map((l) => l.passages)).toEqual([[1, 2], [3]]);
  });
});

describe("copySource", () => {
  const ps = [op(1, 10, "W1"), op(2, 10, "W1"), op(3, 10, "W1"), op(4, 10, "W1")];
  it("copies the exact stored text, file and page, in reading order", () => {
    const q = copySource([3, 1], ps);
    expect(q).toEqual([
      { passageId: "p1", file: "W1.txt", page: 1, text: "text 1" },
      { passageId: "p3", file: "W1.txt", page: 3, text: "text 3" },
    ]);
  });
  it("drops numbers that aren't the layer's passages, and duplicates", () => {
    expect(copySource([2, 2, 99, 0, -1], ps).map((q) => q.passageId)).toEqual(["p2"]);
  });
  it("is never empty: with no valid pick it uses the layer's first passages", () => {
    expect(copySource([], ps).map((q) => q.passageId)).toEqual(["p1", "p2", "p3"]);
    expect(copySource([42], ps)).toHaveLength(3);
  });
});

describe("blocksForPassages: Source keeps the shape of the original", () => {
  const w = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${i}`).join(" ");
  const blocks: Block[] = [
    { kind: "heading", text: "Part One: Faction", page: 1, level: 1 },
    { kind: "paragraph", text: `${w(150, "a")}. ${w(120, "b")}.`, page: 1 },
    { kind: "list", text: "- first item here\n- second item here\n- third item here", page: 1 },
    { kind: "paragraph", text: `${w(400, "c")}.`, page: 2 },
  ];
  const section = { title: "t", blocks, pageStart: 1, pageEnd: 2, wordCount: 0 };
  const passages = makePassages(section);
  const frags = blocksForPassages(blocks, passages.map((p) => p.text.split(/\s+/).filter(Boolean).length));
  const words = (t: string) => t.split(/\s+/).filter(Boolean);

  it("returns, for every passage, exactly the passage's words", () => {
    expect(passages.length).toBeGreaterThan(2);
    passages.forEach((p, i) => expect(words(frags[i].map((f) => f.text).join(" "))).toEqual(words(p.text)));
  });
  it("every piece is a verbatim slice of one original block, with that block's kind", () => {
    frags.flat().forEach((f) => expect(blocks.some((b) => b.kind === f.kind && b.text.includes(f.text))).toBe(true));
  });
  it("keeps the heading as a heading and the list's line breaks", () => {
    expect(frags[0][0]).toEqual({ kind: "heading", text: "Part One: Faction" });
    const list = frags.flat().filter((f) => f.kind === "list");
    expect(list.map((f) => f.text).join("\n")).toContain("- first item here\n- second item here");
  });
  it("a long paragraph cut across passages stays in the paragraph kind", () => {
    const cuts = frags.flat().filter((f) => f.text.includes("c1") || f.text.includes("c399"));
    expect(cuts.every((f) => f.kind === "paragraph")).toBe(true);
  });
});

// ----------------------------------------------------------------------------- the service, on a real imported course

const enc = (t: string) => new TextEncoder().encode(t);
let seed = 0;
const words = (n: number) => Array.from({ length: n }, () => `qx${++seed}z`).join(" ");
const wrapped = (paragraphs: number) =>
  Array.from({ length: paragraphs }, (_, p) => {
    const w = words(60).split(" ");
    const lines: string[] = [];
    for (let i = 0; i < w.length; i += 10) lines.push(w.slice(i, i + 10).join(" "));
    if (p === 0) {
      lines[1] = `${lines[1]} inef-`;
      lines[2] = `ficacy ${lines[2]}`;
    }
    return lines.join("\n");
  }).join("\n\n");

let db: Db;
let projectId: string;

beforeAll(() => {
  process.env.MARGIN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "margin-layers-"));
});
beforeEach(async () => {
  db = openDb(":memory:").db;
  projectId = createProject(db, { name: "POL101 Politics" });
  const files: [string, string, string][] = [
    ["a.txt", "Week 1 - Foundations/a.txt", `FEDERALIST No. 1\n\nIntro\n\n${wrapped(30)}\n\nFEDERALIST No. 2\n\nDangers\n\n${wrapped(30)}`],
    ["b.txt", "Week 2 - Faction/b.txt", wrapped(40)],
    ["c.txt", "Week 3 - Checks/c.txt", wrapped(40)],
    ["d.txt", "Week 4 - Review/d.txt", wrapped(40)],
  ];
  for (const [name, relPath, text] of files) await addFile(db, projectId, { name, relPath, bytes: enc(text) });
  await analyzeProject(db, cannedEngine(), projectId);
});

const layerPassageCount = () => db.select().from(s.layerPassages).all().length;
const passageCount = () => db.select().from(s.passages).all().length;
const layerIds = (week: number) => getStructure(db, projectId)!.weeks.find((w) => w.week === week)!.layers.map((l) => l.id);

describe("proposing the structure", () => {
  it("makes one group per week, with the week's own passages, and every passage lands in exactly one layer", async () => {
    await proposeStructure(db, cannedEngine(), projectId);
    const st = getStructure(db, projectId)!;
    expect(st.weeks.map((w) => [w.label, w.status])).toEqual([["Week 1 · Foundations", "proposed"], ["Week 2 · Faction", "proposed"], ["Week 3 · Checks", "proposed"], ["Week 4 · Review", "proposed"]]);
    expect(st.weeks.every((w) => w.layers.length >= 1 && w.layers.length <= MAX_LAYERS_PER_WEEK)).toBe(true);
    expect(layerPassageCount()).toBe(passageCount());
    // a week's layers hold only that week's file
    for (const w of st.weeks) expect(new Set(w.layers.flatMap((l) => l.sources.map((x) => x.file)))).toEqual(new Set([["a.txt", "b.txt", "c.txt", "d.txt"][w.week - 1]]));
    expect(st.project.status).toBe("building");
  });

  it("asks the plan model once per week and writes no layer content", async () => {
    const engine = cannedEngine();
    await proposeStructure(db, engine, projectId);
    expect(engine.calls.length).toBe(4); // one per week
    expect(engine.calls.every((c) => c.model === "claude-opus-5-5" && c.effort === "medium")).toBe(true);
    expect(engine.calls.map((c) => c.prompt.split("\n")[1]).sort()).toEqual(["Week 1 · Foundations", "Week 2 · Faction", "Week 3 · Checks", "Week 4 · Review"]);
    expect(db.select().from(s.layerContent).all()).toEqual([]);
  });

  it("an invalid proposal is retried once with the reasons, and a second failure falls back to a layer per file", async () => {
    const bad = new FakeEngine({ json: (req: AiRequest) => (req.system.includes("CHAIN OF IDEAS") ? { layers: [{ title: "Only", bigQuestion: "What is only?", buildsOn: "", ranges: [{ from: 1, to: 2 }] }] } : cannedJson(req)) });
    await proposeStructure(db, bad, projectId);
    const calls = bad.calls.filter((c) => c.system.includes("CHAIN OF IDEAS"));
    expect(calls).toHaveLength(8); // two attempts per week
    expect(calls.some((c) => c.prompt.includes("Your last proposal was rejected"))).toBe(true);
    expect(layerPassageCount()).toBe(passageCount()); // the fallback still covers everything
    expect(getStructure(db, projectId)!.note).toMatch(/Week 1 · Foundations, .*those weeks were split by file instead/); // and the student is told
  });

  it("a valid plan carries no note, and proposing again clears an old one", async () => {
    await proposeStructure(db, new FakeEngine({ json: (req: AiRequest) => (req.system.includes("CHAIN OF IDEAS") ? { layers: [] } : cannedJson(req)) }), projectId).catch(() => undefined);
    await proposeStructure(db, cannedEngine(), projectId);
    expect(getStructure(db, projectId)!.note).toBeNull();
  });

  it("a missing claude is an error, not a silent fallback", async () => {
    const { ClaudeNotInstalled } = await import("@/lib/ai/errors");
    const e = new FakeEngine({ json: () => { throw new ClaudeNotInstalled(); } });
    await expect(proposeStructure(db, e, projectId)).rejects.toBeInstanceOf(ClaudeNotInstalled);
    expect(getStructure(db, projectId)!.weeks.flatMap((w) => w.layers)).toEqual([]);
  });

  it("Cancel stops the plan: an aborted proposal writes nothing", async () => {
    const ctl = new AbortController();
    const slow = new FakeEngine({ json: cannedJson, delayMs: 200 });
    const run = proposeStructure(db, slow, projectId, ctl.signal);
    setTimeout(() => ctl.abort(), 20);
    await expect(run).rejects.toThrow();
    expect(db.select().from(s.parts).all()).toEqual([]);
    expect(db.select().from(s.layers).all()).toEqual([]);
  });

  it("can't be proposed again once the plan is approved", async () => {
    await proposeStructure(db, cannedEngine(), projectId);
    approvePlan(db, projectId);
    await expect(proposeStructure(db, cannedEngine(), projectId)).rejects.toBeInstanceOf(GateError);
  });

  it("says so plainly when there isn't enough text", async () => {
    const empty = createProject(db, { name: "Empty" });
    await expect(proposeStructure(db, cannedEngine(), empty)).rejects.toBeInstanceOf(StructureError);
  });
});

describe("the approval gate", () => {
  it("writes nothing and calls no engine before the plan is approved", async () => {
    await proposeStructure(db, cannedEngine(), projectId);
    const engine = cannedEngine();
    const [first] = layerIds(1);
    expect(() => writeLayerContent(db, engine, first)).toThrow(GateError);
    expect(engine.calls).toHaveLength(0);
    expect(db.select().from(s.layerContent).all()).toEqual([]);
  });

  it("Looks good approves every week at once and the project is ready", async () => {
    await proposeStructure(db, cannedEngine(), projectId);
    approvePlan(db, projectId);
    expect(getStructure(db, projectId)!.weeks.every((w) => w.status === "approved")).toBe(true);
    expect(getStructure(db, projectId)!.project.status).toBe("ready");
    await writeLayerContent(db, cannedEngine(), layerIds(4)[0]);
  });
});

describe("writing a layer", () => {
  async function approved() {
    await proposeStructure(db, cannedEngine(), projectId);
    approvePlan(db, projectId); // "Looks good"
  }

  it("writes Source and Explained once, caches them, and a second open makes no engine call", async () => {
    await approved();
    const engine = cannedEngine();
    const id = layerIds(1)[0];
    await writeLayerContent(db, engine, id);
    const first = engine.calls.length;
    const writing = engine.calls.filter((c) => c.task !== "brain");
    expect(writing).toHaveLength(2); // pick Source, write Explained (after the brain reads the layer's file, if it hadn't yet)
    expect(writing.every((c) => c.model === "claude-opus-5-5" && c.effort === "low")).toBe(true);
    await writeLayerContent(db, engine, id);
    expect(engine.calls).toHaveLength(first);
    const view = getLayer(db, id)!;
    expect(view.contentStatus).toBe("ready");
    expect(view.content!.source.length).toBeGreaterThan(0);
    const explained = view.content!.explained;
    expect("sections" in explained && explained.sections.length).toBeGreaterThanOrEqual(2);
  });

  it("two opens at once share one write", async () => {
    await approved();
    const engine = cannedEngine();
    const id = layerIds(1)[0];
    await Promise.all([writeLayerContent(db, engine, id), writeLayerContent(db, engine, id)]);
    expect(engine.calls.filter((c) => c.task !== "brain")).toHaveLength(2);
  });

  it("Source is verbatim: every quote is a substring of the stored original, with the right file and page", async () => {
    await approved();
    const norm = (t: string) => t.replace(/-\s*\n\s*(?=[a-z])/g, "").split(/\s+/).filter(Boolean).join(" ");
    for (const id of [...layerIds(1), ...layerIds(2)]) {
      await writeLayerContent(db, cannedEngine(), id);
      for (const q of getLayer(db, id)!.content!.source) {
        const passage = db.select().from(s.passages).where(eq(s.passages.id, q.passageId)).get()!;
        expect(q.text).toBe(passage.text);
        expect(q.page).toBe(passage.page);
        const section = db.select().from(s.sections).where(eq(s.sections.id, passage.sectionId)).get()!;
        const file = db.select().from(s.files).where(eq(s.files.id, passage.fileId)).get()!;
        expect(q.file).toBe(file.name);
        expect(norm(section.original.map((b) => b.text).join(" "))).toContain(norm(q.text));
      }
    }
  });

  it("Source quotes carry their original blocks: the same words as the quote, each a verbatim slice of the section", async () => {
    await approved();
    const id = layerIds(1)[0];
    await writeLayerContent(db, cannedEngine(), id);
    const words = (t: string) => t.split(/\s+/).filter(Boolean);
    const quotes = getLayer(db, id)!.content!.source;
    expect(quotes.every((q) => q.blocks && q.blocks.length > 0)).toBe(true);
    for (const q of quotes) {
      expect(words(q.blocks!.map((b) => b.text).join(" "))).toEqual(words(q.text));
      const passage = db.select().from(s.passages).where(eq(s.passages.id, q.passageId)).get()!;
      const section = db.select().from(s.sections).where(eq(s.sections.id, passage.sectionId)).get()!;
      for (const b of q.blocks!) expect(section.original.some((o) => o.kind === b.kind && o.text.includes(b.text))).toBe(true);
    }
  });

  it("a model that invents or alters a quote has it dropped: Source never contains model-written text", async () => {
    await approved();
    const liar = new FakeEngine({
      json: (req: AiRequest) => (req.system.includes("You choose the source passages") ? { passages: [1, 9999] } : cannedJson(req)),
      text: cannedText,
    });
    const id = layerIds(1)[0];
    await writeLayerContent(db, liar, id);
    const stored = new Set(db.select().from(s.passages).all().map((p) => p.text));
    const source = getLayer(db, id)!.content!.source;
    expect(source).toHaveLength(1);
    expect(source.every((q) => stored.has(q.text))).toBe(true);
  });

  it("a failed write leaves the layer retryable", async () => {
    await approved();
    const id = layerIds(1)[0];
    const broken = new FakeEngine({ json: () => { throw new Error("boom"); } });
    await expect(writeLayerContent(db, broken, id)).rejects.toThrow("boom");
    expect(getLayer(db, id)!.contentStatus).toBe("none");
    await writeLayerContent(db, cannedEngine(), id);
    expect(getLayer(db, id)!.contentStatus).toBe("ready");
  });
});

describe("editing the proposed layers", () => {
  /** Three layers a week, each a third of the week's passages, so a week has neighbours to merge, split and move. */
  const threeAWeek = new FakeEngine({
    json: (req: AiRequest) => {
      const n = [...req.prompt.matchAll(/^#(\d+) \|/gm)].length;
      const cut = (k: number) => Math.round((n * k) / 3);
      return { layers: [0, 1, 2].map((k) => ({ title: `Idea ${k + 1} of ${req.prompt.split("\n")[0]}`, bigQuestion: `What is idea ${k + 1}?`, buildsOn: "", ranges: [{ from: cut(k) + 1, to: cut(k + 1) }] })) };
    },
  });
  beforeEach(async () => {
    await proposeStructure(db, threeAWeek, projectId);
  });
  const coverage = () => expect(layerPassageCount()).toBe(passageCount());

  it("renames a layer and changes its question", () => {
    const [id] = layerIds(1);
    updateLayer(db, id, { title: "  What a faction is ", bigQuestion: "Why does it matter?" });
    const l = getStructure(db, projectId)!.weeks[0].layers[0];
    expect(l.title).toBe("What a faction is");
    expect(l.bigQuestion).toBe("Why does it matter?");
    expect(() => updateLayer(db, id, { title: "  " })).toThrow(StructureError);
  });

  it("merges a layer with the next one, keeping every passage", () => {
    const before = layerIds(1);
    const words0 = getStructure(db, projectId)!.weeks[0].layers.slice(0, 2).reduce((n, l) => n + l.words, 0);
    mergeWithNext(db, before[0]);
    const after = getStructure(db, projectId)!.weeks[0].layers;
    expect(after).toHaveLength(before.length - 1);
    expect(after[0].words).toBe(words0);
    expect(after.map((l) => l.position)).toEqual(after.map((_, i) => i));
    coverage();
  });

  it("can't merge the last layer of a week", () => {
    const a = layerIds(1);
    expect(() => mergeWithNext(db, a[a.length - 1])).toThrow(StructureError);
  });

  it("splits a layer at a real part near the middle by words, keeping every passage", () => {
    const [id] = layerIds(1);
    const original = getStructure(db, projectId)!.weeks[0].layers[0];
    splitLayer(db, id);
    const layers = getStructure(db, projectId)!.weeks[0].layers;
    expect(layers[0].words + layers[1].words).toBe(original.words);
    expect(layers[1].title).toMatch(new RegExp(`^${original.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)); // named after the layer it came from
    expect(layers.map((l) => l.position)).toEqual(layers.map((_, i) => i));
    coverage();
  });

  it("moves a layer up and down within a week", () => {
    const [a0, a1] = layerIds(1);
    moveLayer(db, a0, "down");
    expect(layerIds(1).slice(0, 2)).toEqual([a1, a0]);
    moveLayer(db, a0, "up");
    expect(layerIds(1).slice(0, 2)).toEqual([a0, a1]);
  });

  it("at the edge a layer crosses into the next week", () => {
    const a = layerIds(1);
    const lastA = a[a.length - 1];
    moveLayer(db, lastA, "down");
    expect(layerIds(1)).toHaveLength(a.length - 1);
    expect(layerIds(2)[0]).toBe(lastA);
    moveLayer(db, lastA, "up");
    expect(layerIds(1)[layerIds(1).length - 1]).toBe(lastA);
    coverage();
  });

  it("can't move past the ends of the course; a week emptied by a move is no longer listed with layers", () => {
    expect(() => moveLayer(db, layerIds(1)[0], "up")).toThrow(/first layer/);
    const d = layerIds(4);
    expect(() => moveLayer(db, d[d.length - 1], "down")).toThrow(/last layer/);
    while (layerIds(1).length > 1) mergeWithNext(db, layerIds(1)[0]);
    moveLayer(db, layerIds(1)[0], "down");
    const st = getStructure(db, projectId)!;
    expect(st.weeks[0]).toMatchObject({ week: 1, id: null, layers: [] });
    coverage();
  });

  it("moves a layer to any week, one with no layers yet too", () => {
    const [a0] = layerIds(1);
    moveLayerToWeek(db, a0, 3);
    expect(layerIds(3)[0]).toBe(a0); // a later week: at its start
    db.update(s.projects).set({ weekCount: 6 }).where(eq(s.projects.id, projectId)).run();
    moveLayerToWeek(db, a0, 6);
    expect(getStructure(db, projectId)!.weeks.find((w) => w.week === 6)!.layers.map((l) => l.id)).toEqual([a0]);
    expect(() => moveLayerToWeek(db, a0, 9)).toThrow(/this course's weeks/);
    coverage();
  });

  it("editing an approved breakdown marks changed layers' content stale and keeps the untouched ones", async () => {
    approvePlan(db, projectId);
    const [a0, a1, a2] = layerIds(1);
    const engine = cannedEngine();
    for (const id of [a0, a1, a2]) await writeLayerContent(db, engine, id);
    updateLayer(db, a0, { title: "Only a new title" }); // wording only: content stays valid
    expect(getLayer(db, a0)!.contentStatus).toBe("ready");
    updateLayer(db, a0, { bigQuestion: "A different question entirely?" });
    expect(getLayer(db, a0)!.contentStatus).toBe("stale");
    mergeWithNext(db, a1); // a1 and a2 merge
    expect(getLayer(db, a1)!.contentStatus).toBe("stale");
    expect(getLayer(db, a2)).toBeNull();
    // stale content is rewritten on the next open
    const calls = engine.calls.length;
    await writeLayerContent(db, engine, a0);
    expect(engine.calls.length).toBe(calls + 2);
    expect(getLayer(db, a0)!.contentStatus).toBe("ready");
  });

  it("approval refuses a breakdown that doesn't cover all the text", () => {
    db.delete(s.layerPassages).where(eq(s.layerPassages.passageId, db.select().from(s.layerPassages).limit(1).get()!.passageId)).run();
    expect(() => approvePlan(db, projectId)).toThrow(/isn't in any layer/);
  });
});

describe("re-importing", () => {
  it("clears the old layers, since they pointed at passages that no longer exist", async () => {
    await proposeStructure(db, cannedEngine(), projectId);
    await analyzeProject(db, cannedEngine(), projectId);
    expect(getStructure(db, projectId)!.weeks.flatMap((w) => w.layers)).toEqual([]);
    expect(db.select().from(s.layers).all()).toEqual([]);
  });
});
