// @vitest-environment node
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readIntoBrain } from "@/lib/brain/read";
import { courseFiles } from "@/lib/brain/store";
import { cannedEngine } from "@/lib/ai/canned";
import { diagram, focusLines, labelHeight } from "@/components/cinematic/geometry";
import { openDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { demoSeedSchema, exportDemoSeed, importDemoSeed } from "@/lib/demo/seed";
import { listProjectCards } from "@/lib/layers/home";
import { getNoteToSelf } from "@/lib/layers/note-to-self";
import { flattenLayers, neighbours, positionLabel } from "@/lib/layers/order";
import { countStates, progressLabel } from "@/lib/layers/progress";
import { searchProject } from "@/lib/layers/search";
import { getLayer, getStructure, writeLayerContent } from "@/lib/layers/service";
import { getViewModes, setViewMode } from "@/lib/layers/view-mode";
import { refuseIfDemo } from "@/lib/projects/demo-guard";
import { makeApprovedProject } from "./helpers/course";

let db: Db;
beforeAll(() => {
  process.env.MARGIN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "margin-p4-"));
});
beforeEach(() => {
  db = openDb(":memory:").db;
});

describe("progress", () => {
  it("counts saved and not saved", () => {
    expect(countStates(["saved", "saved", "not_saved", "saved", "not_saved"])).toEqual({ total: 5, saved: 3, notSaved: 2 });
  });
  it.each([
    [["saved", "saved", "saved", "saved", "not_saved", "not_saved", "not_saved"], "4/7 layers saved"],
    [["saved", "not_saved"], "1/2 layers saved"],
    [["saved"], "1/1 layer saved"],
    [["not_saved", "not_saved"], "0/2 layers saved"],
    [[], "0/0 layers saved"],
  ] as const)("says it plainly: %j", (states, label) => {
    expect(progressLabel(countStates([...states]))).toBe(label);
  });
});

describe("the layer list order", () => {
  const model = {
    weeks: [
      { week: 1, label: "Week 1 · Foundations", layers: [{ id: "a1" }, { id: "a2" }] },
      { week: 2, label: "Week 2", layers: [] },
      { week: 3, label: "Week 3 · Faction", layers: [{ id: "b1" }, { id: "b2" }, { id: "b3" }] },
    ],
  };
  const flat = flattenLayers(model as never);
  it("runs week 1's layers, then the next week's that has any", () => expect(flat.map((l) => l.id)).toEqual(["a1", "a2", "b1", "b2", "b3"]));
  it("previous and next cross from one week to the next, and stop at the ends", () => {
    expect(neighbours(flat, "a2").next?.id).toBe("b1");
    expect(neighbours(flat, "b1").prev?.id).toBe("a2");
    expect(neighbours(flat, "a1").prev).toBeUndefined();
    expect(neighbours(flat, "b3").next).toBeUndefined();
  });
  it("says where you are in the week", () => {
    expect(positionLabel(flat, "b2")).toBe("Week 3 · Faction, layer 2 of 3");
    expect(positionLabel(flat, "a1")).toBe("Week 1 · Foundations, layer 1 of 2");
  });
});

describe("the teardown fits every layer count from 1 to 12", () => {
  for (const vp of [{ w: 1024, h: 768 }, { w: 1440, h: 900 }, { w: 1600, h: 900 }]) {
    it(`at ${vp.w} wide: labels stay on screen and never touch`, () => {
      for (let n = 1; n <= 12; n++) {
        const d = diagram(vp, n);
        const top = (i: number) => d.rowY(i) + d.cornerY - 11;
        const lines = focusLines(d.step);
        expect(d.labelX + d.labelW, `n=${n} label right edge`).toBeLessThanOrEqual(vp.w);
        expect(d.labelW, `n=${n} label width`).toBeGreaterThanOrEqual(240);
        expect(top(0), `n=${n} first label`).toBeGreaterThanOrEqual(60);
        expect(top(n - 1) + labelHeight(lines), `n=${n} last label`).toBeLessThanOrEqual(vp.h - 20);
        if (n > 1) expect(labelHeight(lines), `n=${n} label height fits the row gap`).toBeLessThanOrEqual(d.step);
        // the sheets themselves stay inside the window too
        expect(d.cx - d.halfW, `n=${n} sheet left`).toBeGreaterThanOrEqual(0);
        expect(d.cx + d.halfW, `n=${n} sheet right`).toBeLessThan(d.labelX);
      }
    });
  }
});

describe("a layer's state comes from what is saved to Note to Self", () => {
  it("is not saved until the student sends a version, and a draft alone changes nothing", async () => {
    const p = await makeApprovedProject(db);
    const [a, b, c] = p.layers();
    expect(p.layers().every((l) => l.state === "not_saved")).toBe(true);
    db.insert(s.writebacks).values({ id: "w1", targetType: "layer", targetId: a.id, text: "my draft" }).run();
    db.insert(s.writebacks).values({ id: "w2", targetType: "layer", targetId: b.id, text: "my second layer" }).run();
    db.insert(s.noteSaves).values({ id: "n2", targetType: "layer", targetId: b.id, writebackId: "w2", version: "own", text: "my second layer" }).run();
    const st = getStructure(db, p.id)!;
    const byId = new Map(st.weeks.flatMap((x) => x.layers).map((l) => [l.id, l.state]));
    expect([byId.get(a.id), byId.get(b.id), byId.get(c.id)]).toEqual(["not_saved", "saved", "not_saved"]);
    expect(st.weeks.map((w) => w.progress.saved)).toEqual([0, 1, 0, 0]); // b is week 2's layer
    expect(st.progress.saved).toBe(1);
    expect(st.resume?.layerId).toBe(a.id); // nothing is locked, so "continue" is simply the first layer not saved
  });
});

describe("Note to Self holds only what was sent", () => {
  it("shows each saved version by week and layer with its label, and never drafts, chat or a version that was not chosen", async () => {
    const p = await makeApprovedProject(db);
    const [a, b] = p.layers();
    db.insert(s.writebacks).values({ id: "d1", targetType: "layer", targetId: a.id, text: "FIRST DRAFT, not sent", review: { fixes: [{ kind: "grammar", text: "x" }], cleanedUp: "CLEANED UP VERSION", soWhat: "A so what here.", verdict: "needs_work" } }).run();
    db.insert(s.writebacks).values({ id: "d2", targetType: "layer", targetId: a.id, text: "MY OWN WORDS for layer one", review: { fixes: [], cleanedUp: "REFINED TEXT for layer one", soWhat: "Another so what.", verdict: "approved" } }).run();
    db.insert(s.layerMessages).values({ id: "m1", targetType: "layer", targetId: a.id, role: "assistant", kind: "review", content: "CHAT MESSAGE" }).run();
    db.insert(s.writebacks).values({ id: "d3", targetType: "layer", targetId: b.id, text: "layer two own text", review: { fixes: [], cleanedUp: "layer two REFINED SENT", soWhat: "Yet another so what.", verdict: "approved" } }).run();
    db.insert(s.noteSaves).values({ id: "f1", targetType: "layer", targetId: a.id, writebackId: "d2", version: "own", text: "MY OWN WORDS for layer one" }).run();
    db.insert(s.noteSaves).values({ id: "f3", targetType: "layer", targetId: b.id, writebackId: "d3", version: "refined", text: "layer two REFINED SENT" }).run();

    const notes = getNoteToSelf(db, p.id);
    expect(notes.map((x) => x.key)).toEqual(["W1", "W2", "W3", "W4"]);
    expect(notes.flatMap((x) => x.layers).map((l) => [l.id, l.version, l.text])).toEqual([
      [a.id, "own", "MY OWN WORDS for layer one"],
      [b.id, "refined", "layer two REFINED SENT"],
    ]);
    const everything = JSON.stringify(notes);
    for (const banned of ["FIRST DRAFT", "CLEANED UP VERSION", "REFINED TEXT for layer one", "CHAT MESSAGE", "so what"]) expect(everything).not.toContain(banned);
    expect(notes[2].layers).toEqual([]); // layers with nothing saved are simply not there
  });
  it("is empty before anything is finished", async () => {
    const p = await makeApprovedProject(db);
    expect(getNoteToSelf(db, p.id).every((x) => x.layers.length === 0 && x.synthesis === null)).toBe(true);
  });
});

describe("the tab for each layer is remembered", () => {
  it("defaults to nothing stored (Explained), is per layer, and survives closing the database", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "margin-view-")), "v.db");
    const first = openDb(file);
    const p = await makeApprovedProject(first.db);
    const [a, b] = p.layers();
    expect(getViewModes(first.db, p.id)).toEqual({});
    setViewMode(first.db, p.id, a.id, "source");
    setViewMode(first.db, p.id, b.id, "explained");
    setViewMode(first.db, p.id, b.id, "source");
    setViewMode(first.db, p.id, b.id, "explained");
    first.sqlite.close();
    const again = openDb(file);
    expect(getViewModes(again.db, p.id)).toEqual({ [a.id]: "source", [b.id]: "explained" });
  });
});

describe("searching the files from the command bar", () => {
  it("finds a passage by its words and says which layer holds it", async () => {
    const p = await makeApprovedProject(db);
    const passage = db.select().from(s.passages).limit(1).get()!;
    const word = passage.text.split(" ")[3];
    const hits = searchProject(db, p.id, word);
    expect(hits[0]).toMatchObject({ file: expect.any(String), page: passage.page });
    expect(hits[0].layerId).toBeTruthy();
    expect(hits[0].snippet).toContain(word);
    expect(searchProject(db, p.id, "")).toEqual([]);
    expect(() => searchProject(db, p.id, `"(( -* AND`)).not.toThrow();
  });
});

describe("the demo", () => {
  async function seeded() {
    const p = await makeApprovedProject(db, "The Federalist Papers");
    // as the demo build does: the brain reads every file, then the layers are written
    for (const f of courseFiles(db, p.id)) await readIntoBrain(db, cannedEngine(), f.id);
    for (const l of p.layers().slice(0, 2)) await writeLayerContent(db, cannedEngine(), l.id);
    return { p, seed: demoSeedSchema.parse(JSON.parse(JSON.stringify(exportDemoSeed(db, p.id)))) };
  }

  it("round-trips: a fresh database gets the same course, already approved and written, marked read-only", async () => {
    const { p, seed } = await seeded();
    const fresh = openDb(":memory:").db;
    const id = importDemoSeed(fresh, seed);
    expect(id).not.toBe(p.id);
    const before = getStructure(db, p.id)!;
    const after = getStructure(fresh, id)!;
    expect(after.project).toMatchObject({ name: "The Federalist Papers", isDemo: true, status: "ready" });
    expect(after.weeks.map((x) => [x.label, x.status, x.layers.map((l) => l.title)])).toEqual(before.weeks.map((x) => [x.label, "approved", x.layers.map((l) => l.title)]));
    const first = after.weeks[0].layers[0];
    const view = getLayer(fresh, first.id)!;
    expect(view.contentStatus).toBe("ready");
    expect(view.content!.source.length).toBeGreaterThan(0);
    // the Source text is still the stored passage text, under the new ids
    for (const q of view.content!.source) expect(fresh.select().from(s.passages).where(eq(s.passages.id, q.passageId)).get()!.text).toBe(q.text);
  });

  it("carries the course brain: its notes, each file's mentions pointing at the same passages under new ids, its links and reads", async () => {
    const { p, seed } = await seeded();
    expect(seed.brainNotes!.length).toBeGreaterThan(0);
    const fresh = openDb(":memory:").db;
    const id = importDemoSeed(fresh, seed);
    const notes = (d: Db, pid: string) => d.select().from(s.brainNotes).where(eq(s.brainNotes.projectId, pid)).all().map((n) => n.name).sort();
    expect(notes(fresh, id)).toEqual(notes(db, p.id));
    const mentions = fresh.select().from(s.brainMentions).where(eq(s.brainMentions.projectId, id)).all();
    expect(mentions.length).toBe(seed.brainMentions!.length);
    for (const m of mentions) for (const pid of m.passageIds) expect(fresh.select().from(s.passages).where(eq(s.passages.id, pid)).get()?.projectId).toBe(id);
    expect(fresh.select().from(s.brainReads).where(eq(s.brainReads.projectId, id)).all()).toHaveLength(seed.brainReads!.length);
    expect(fresh.select().from(s.brainLinks).where(eq(s.brainLinks.projectId, id)).all()).toHaveLength(seed.brainLinks!.length);
  });

  it("opening the demo twice gives the same project", async () => {
    const { seed } = await seeded();
    const fresh = openDb(":memory:").db;
    expect(importDemoSeed(fresh, seed)).toBe(importDemoSeed(fresh, seed));
    expect(fresh.select().from(s.projects).all()).toHaveLength(1);
  });

  it("its structure is read-only: the guard answers 403 for its project, files and units", async () => {
    const { seed } = await seeded();
    const fresh = openDb(":memory:").db;
    const id = importDemoSeed(fresh, seed);
    const file = fresh.select().from(s.files).limit(1).get()!;
    const unit = fresh.select().from(s.units).limit(1).get()!;
    for (const where of [{ projectId: id }, { fileId: file.id }, { unitId: unit.id }]) expect(refuseIfDemo(fresh, where)?.status).toBe(403);
    expect(refuseIfDemo(db, { projectId: "not-a-demo" })).toBeNull();
  });
});

describe("the home page cards", () => {
  it("show the week the course is in, its progress, where to continue, and where an unfinished project (a draft) opens", async () => {
    const p = await makeApprovedProject(db);
    const half = createHalf();
    const cards = listProjectCards(db);
    const ready = cards.find((c) => c.id === p.id)!;
    expect(ready).toMatchObject({ ready: true, href: `/p/${p.id}`, name: "POL101 Politics" });
    expect(ready).toMatchObject({ draft: false, currentWeek: 4, weekCount: 4 }); // no syllabus dates: the latest week with material
    expect(ready.progress).toEqual({ total: p.layers().length, saved: 0, notSaved: p.layers().length });
    expect(ready.resume).toBe(p.layers()[0].title);
    expect(cards.find((c) => c.id === half)).toMatchObject({ ready: false, draft: true, href: `/p/${half}/setup`, resume: "Plan the layers" });
    function createHalf() {
      const id = "half-built";
      db.insert(s.projects).values({ id, name: "Half built", status: "reviewing" }).run();
      return id;
    }
  });
});
