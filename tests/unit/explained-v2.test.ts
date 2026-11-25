// @vitest-environment node
/**
 * Explained: written from the layer's passages and whatever the brain has on them, in its shape (summary, big question, sections answering
 * sub-questions with every named thing explained where it matters, so what), its length a share of about 4,000 words a week. Writing never
 * waits for the brain; the named-things check runs once the brain has read the layer's files. Old layers keep their Explained until
 * refreshed. The fake engine and a temporary data folder only.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { cannedEngine } from "@/lib/ai/canned";
import type { AiRequest } from "@/lib/ai/engine";
import { isExplainedV2 } from "@/lib/ai/schemas";
import { openDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { explainedWords } from "@/lib/layers/explained-length";
import { foldLoneCitations, isExplained, unexplained } from "@/lib/layers/explained-check";
import { nextBrainFile } from "@/lib/brain/queue";
import { readIntoBrain } from "@/lib/brain/read";
import { approvePlan, checkLayerConcepts, getLayer, getStructure, layersAwaitingConcepts, proposeStructure, refreshLayer, writeLayerContent } from "@/lib/layers/service";
import { addFile, analyzeProject, createProject } from "@/lib/projects/service";

let db: Db;
beforeEach(() => {
  db = openDb(":memory:").db;
});
const enc = (t: string) => new TextEncoder().encode(t);
let seed = 0;
const filler = (n: number) => Array.from({ length: n }, () => `zv${++seed}x`).join(" ");

async function course() {
  const id = createProject(db, { name: "HIS210 Harbours" });
  await addFile(db, id, { name: "Orlen.txt", relPath: "Week 1/Orlen.txt", bytes: enc([`${filler(60)} The Customs House taxed every ship. ${filler(60)}`, `${filler(60)} Admiral Varga sank the fleet by the Customs House. ${filler(60)}`].join("\n\n")) });
  await addFile(db, id, { name: "Tavi.txt", relPath: "Week 2/Tavi.txt", bytes: enc(`${filler(60)} The Ledger Reform ended the war. ${filler(60)}`) });
  await analyzeProject(db, cannedEngine(), id);
  await proposeStructure(db, cannedEngine(), id);
  approvePlan(db, id);
  return id;
}

describe("writing Explained in the new shape", () => {
  it("never waits for the brain: writes at once, asks the brain to read the layer's files next, and checks the named things once they are read", async () => {
    const id = await course();
    const layer = getStructure(db, id)!.weeks[0].layers[0];
    const seen: AiRequest[] = [];
    const engine = cannedEngine();
    await writeLayerContent(db, engine, layer.id);
    seen.push(...engine.calls);
    expect(seen.some((r) => r.task === "brain")).toBe(false);
    const explain = seen.find((r) => r.task === "explain")!;
    expect(explain.prompt).toMatch(/Margin hasn't finished its own notes on these files/);
    expect(explain.prompt).toContain("## The week\nWeek 1");
    const first = getLayer(db, layer.id)!.content!.explained;
    expect(isExplainedV2(first) && first.conceptsChecked).toBe(false);
    // the layer's file is the brain's next read, before the queue's own order
    const orlen = db.select().from(s.files).where(eq(s.files.name, "Orlen.txt")).get()!;
    expect(nextBrainFile(db)?.fileId).toBe(orlen.id);
    expect(layersAwaitingConcepts(db)).toEqual([]);
    await readIntoBrain(db, engine, orlen.id);
    expect(layersAwaitingConcepts(db)).toEqual([layer.id]);
    expect(await checkLayerConcepts(db, engine, layer.id)).toBe(1); // Customs: in two of its passages, explained nowhere yet
    const checked = getLayer(db, layer.id)!.content!.explained;
    if (!isExplainedV2(checked)) throw new Error("not v2");
    expect(checked.conceptsChecked).toBe(true);
    expect(isExplained(checked.sections, { name: "Customs", aliases: [], kind: "concept", what: "", passages: 2 })).toBe(true);
    // the rest of the explanation is as it was
    expect(checked.sections.map((x) => x.question)).toEqual(isExplainedV2(first) ? first.sections.map((x) => x.question) : []);
    expect(checked.summary).toBe(isExplainedV2(first) ? first.summary : "");
    expect(layersAwaitingConcepts(db)).toEqual([]);
  });

  it("with the brain's notes in, lists the layer's named things, explains each in the sections and needs no second call", async () => {
    const id = await course();
    const layer = getStructure(db, id)!.weeks[0].layers[0];
    const engine = cannedEngine();
    const orlen = db.select().from(s.files).where(eq(s.files.name, "Orlen.txt")).get()!;
    await readIntoBrain(db, engine, orlen.id);
    const before = engine.calls.length;
    await writeLayerContent(db, engine, layer.id);
    const writing = engine.calls.slice(before);
    expect(writing.map((r) => r.task).sort()).toEqual(["explain", "source"]);
    const prompt = writing.find((r) => r.task === "explain")!.prompt;
    expect(prompt).toMatch(/## Named in these passages: explain every one where it matters[^\n]*\n- Customs \[concept\]/);
    expect(prompt).not.toContain("Ledger"); // another week's concept
    const explained = getLayer(db, layer.id)!.content!.explained;
    if (!isExplainedV2(explained)) throw new Error("not v2");
    expect(explained.question).toBe(layer.bigQuestion);
    expect(explained.conceptsChecked).toBe(true);
    expect(JSON.stringify(explained)).not.toMatch(/"concepts"|alsoMentioned/);
  });

  it("holds a one-layer week near its full share of about 4,000 words", async () => {
    const id = await course();
    const layer = getStructure(db, id)!.weeks[1].layers[0];
    const seen: AiRequest[] = [];
    const engine = cannedEngine();
    await writeLayerContent(db, engine, layer.id);
    seen.push(...engine.calls);
    expect(seen.find((r) => r.task === "explain")!.system).toMatch(/run to about 4000 words, never more than 5000/);
    const words = explainedWords(getLayer(db, layer.id)!.content!.explained);
    expect(words).toBeGreaterThan(4000 * 0.6);
    expect(words).toBeLessThan(5000);
  });

  it("an existing layer keeps its old Explained until it is refreshed", async () => {
    const id = await course();
    const layer = getStructure(db, id)!.weeks[0].layers[0];
    await writeLayerContent(db, cannedEngine(), layer.id);
    const old = { summary: "An explanation written before the new shape, kept as it was.", blocks: [{ type: "heading", text: "Old" }, { type: "paragraph", text: "Old text. [Orlen.txt, p. 1]" }, { type: "paragraph", text: "More. [Orlen.txt, p. 1]" }], soWhat: "It matters for the course." };
    db.update(s.layerContent).set({ explained: old as never }).where(eq(s.layerContent.layerId, layer.id)).run();
    await writeLayerContent(db, cannedEngine(), layer.id); // opening it again writes nothing
    expect(isExplainedV2(getLayer(db, layer.id)!.content!.explained)).toBe(false);
    await refreshLayer(db, cannedEngine(), layer.id);
    expect(isExplainedV2(getLayer(db, layer.id)!.content!.explained)).toBe(true);
  });
});

describe("tidying", () => {
  it("folds a citation that stands alone into the sentence before it, or after it when it comes first", () => {
    expect(
      foldLoneCitations([
        { type: "paragraph", text: "[a.pdf, p. 1]" },
        { type: "paragraph", text: "A fact." },
        { type: "bullets", items: ["One. [a.pdf, p. 2]", "[a.pdf, p. 3]", "Two."] },
        { type: "paragraph", text: " [a.pdf, p. 4]. " },
      ]),
    ).toEqual([
      { type: "paragraph", text: "A fact. [a.pdf, p. 1]" },
      { type: "bullets", items: ["One. [a.pdf, p. 2] [a.pdf, p. 3]", "Two. [a.pdf, p. 4]"] },
    ]);
  });
  it("counts a named thing as explained only where a cited passage of some length names it, by its name, another name, a plural or a surname", () => {
    const note = (name: string, kind = "concept", aliases: string[] = []) => ({ name, aliases, kind, what: "", passages: 2 });
    const para = (text: string) => ({ question: "Why?", blocks: [{ type: "paragraph" as const, text }] });
    const long = "The Ottoman state took boys from Christian families, trained them and made them soldiers and officials who owed everything to the sultan. [a.pdf, p. 2]";
    const sections = [para(`The child levy (devşirme): ${long}`), para("Janissaries, Phanariots and pashas. [a.pdf, p. 3]"), para(`Rigas Velestinlis wrote a charter. Velestinlis matters because ${long}`)];
    expect(isExplained(sections, note("Devşirme"))).toBe(true);
    expect(isExplained(sections, note("Child levy"))).toBe(true);
    expect(isExplained(sections, note("Janissaries"))).toBe(false); // only listed in passing
    expect(isExplained(sections, note("Velestinlis", "person"))).toBe(true);
    expect(isExplained(sections, note("Rigas Velestinlis", "person"))).toBe(true);
    expect(isExplained([para("The devşirme took boys from Christian families and made them soldiers and officials of the sultan, without citing.")], note("Devşirme"))).toBe(false);
    expect(unexplained(sections, [note("Janissaries"), { ...note("Phanariots"), passages: 1 }]).map((n) => n.name)).toEqual(["Janissaries"]); // named once: not held
    // a descriptive name counts where most of its key words come together in a cited passage
    const conquest = [para("Mehmed II took Constantinople in 1453 after a long siege, and Gallant argues the fall mattered more as a symbol than as a change. [a.pdf, p. 4]")];
    expect(isExplained(conquest, note("Fall of Constantinople (1453)", "event"))).toBe(true);
    expect(isExplained(conquest, note("Ottoman entry into Europe and Balkan expansion", "event"))).toBe(false);
  });
});
