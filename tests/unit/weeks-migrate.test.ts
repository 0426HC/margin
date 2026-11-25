import { and, eq, inArray } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { cannedEngine } from "@/lib/ai/canned";
import { isExplainedV2 } from "@/lib/ai/schemas";
import { openDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { demoSeedSchema, importDemoSeed } from "@/lib/demo/seed";
import { mainWeek, migrateAllToWeeks, migratePartsToWeeks, needsWeeks } from "@/lib/layers/migrate-weeks";
import { getNoteGuide, getNoteToSelf } from "@/lib/layers/note-to-self";
import { getLayer, getStructure } from "@/lib/layers/service";
import { saveSynthesis, saveWriteback, submitSynthesis, submitWriteback } from "@/lib/layers/writeback";
import { getQuickNotes, saveQuickNote } from "@/lib/talk/quicknotes";
import { makeApprovedProject } from "./helpers/course";

// Courses made before the weeks round were split into Parts. When the database opens they move to weeks: each layer to the week its
// passages come from, in its old order; each Part synthesis to the last week of that Part. Nothing the student wrote is lost.

let db: Db;
beforeEach(() => {
  db = openDb(":memory:").db;
});

/** Turn a course that is already in weeks back into the old shape: Part A (weeks 1–2) and Part B (weeks 3–4), keyed A and B, no week. */
function backToParts(projectId: string) {
  const rows = db.select().from(s.parts).where(eq(s.parts.projectId, projectId)).all();
  const now = Date.now();
  const [A, B] = [`${projectId}-A`, `${projectId}-B`];
  db.insert(s.parts).values({ id: A, projectId, key: "A", title: "Part A", position: 0, breakdownStatus: "approved", approvedAt: now }).run();
  db.insert(s.parts).values({ id: B, projectId, key: "B", title: "Part B", position: 1, breakdownStatus: "approved", approvedAt: now }).run();
  let a = 0;
  let b = 0;
  for (const r of rows.sort((x, y) => x.week! - y.week!)) {
    const into = r.week! <= 2 ? A : B;
    for (const l of db.select().from(s.layers).where(eq(s.layers.partId, r.id)).all().sort((x, y) => x.position - y.position))
      db.update(s.layers).set({ partId: into, position: into === A ? a++ : b++ }).where(eq(s.layers.id, l.id)).run();
  }
  db.delete(s.parts).where(inArray(s.parts.id, rows.map((r) => r.id))).run();
  return { A, B };
}

describe("moving a course from Parts to weeks", () => {
  it("puts each layer in its week, in order, and keeps every write-up, save, chat and quick note; a Part synthesis goes to the Part's last week", async () => {
    const p = await makeApprovedProject(db);
    const layers = p.layers();
    // the student's work, made while the course is still in weeks so the real functions can be used
    for (const [i, l] of layers.entries()) {
      const r = await submitWriteback(db, cannedEngine(), l.id, `My words for layer ${i}.`);
      if (i % 2 === 0) saveWriteback(db, l.id, r.writebackId, "own");
    }
    saveQuickNote(db, p.id, "layer", layers[0].id, "a -> b");
    const before = { titles: getStructure(db, p.id)!.weeks.map((w) => [w.week, w.layers.map((l) => l.title)]), writebacks: db.select().from(s.writebacks).all().length, saves: db.select().from(s.noteSaves).all().length };

    const { A, B } = backToParts(p.id);
    // a synthesis written for each Part, saved to Note to Self, with quick notes and a chat
    for (const [partId, text] of [[A, "How weeks one and two connect."], [B, "How weeks three and four connect."]] as const) {
      const r = await submitSynthesis(db, cannedEngine(), partId, text);
      saveSynthesis(db, partId, r.writebackId, "own");
      saveQuickNote(db, p.id, "part", partId, `notes for ${partId}`);
    }
    expect(needsWeeks(db, p.id)).toBe(true);

    expect(migratePartsToWeeks(db, p.id)).toBe(true);
    expect(needsWeeks(db, p.id)).toBe(false);
    expect(migratePartsToWeeks(db, p.id)).toBe(false); // once

    const st = getStructure(db, p.id)!;
    expect(st.weeks.map((w) => [w.week, w.layers.map((l) => l.title)])).toEqual(before.titles);
    expect(st.weeks.every((w) => w.status === "approved")).toBe(true);
    expect(st.project.status).toBe("ready");
    expect(db.select().from(s.parts).all().every((r) => r.week !== null && r.key === `W${r.week}`)).toBe(true);

    // every write-up and save is still there: the two syntheses on top of the layers'
    expect(db.select().from(s.writebacks).all()).toHaveLength(before.writebacks + 2);
    expect(db.select().from(s.noteSaves).all()).toHaveLength(before.saves + 2);
    const week = (n: number) => st.weeks.find((w) => w.week === n)!;
    expect(week(2).synthesis).toBe("saved");
    expect(week(4).synthesis).toBe("saved");
    expect(week(1).synthesis).toBe("not_saved");
    const notes = getNoteToSelf(db, p.id);
    expect(notes.find((n) => n.week === 2)!.synthesis).toMatchObject({ kind: "part", text: "How weeks one and two connect.", title: "Week 2 · Faction synthesis" });
    expect(notes.find((n) => n.week === 4)!.synthesis).toMatchObject({ text: "How weeks three and four connect." });
    const quick = getQuickNotes(db, p.id);
    expect(quick[`part:${week(2).id}`]).toBe(`notes for ${A}`);
    expect(quick[`part:${week(4).id}`]).toBe(`notes for ${B}`);
    expect(quick[`layer:${layers[0].id}`]).toBe("a → b");
    // the synthesis chat moved with it
    const chat = db.select().from(s.layerMessages).where(and(eq(s.layerMessages.targetType, "part"), eq(s.layerMessages.targetId, week(4).id!))).all();
    expect(chat.length).toBeGreaterThan(0);
    expect(getNoteGuide(db, p.id)!.finished).toBe(before.saves + 2);
  });

  it("happens on its own when the course is opened, and for every course when the database opens", async () => {
    const one = await makeApprovedProject(db, "One");
    const two = await makeApprovedProject(db, "Two");
    const { A } = backToParts(one.id);
    backToParts(two.id);
    // opening a layer of a course still in Parts moves it first, so the layer knows its week
    const layer = db.select().from(s.layers).where(eq(s.layers.partId, A)).all()[0];
    expect(getLayer(db, layer.id)!.week.label).toBe("Week 1 · Foundations");
    expect(needsWeeks(db, one.id)).toBe(false);
    expect(needsWeeks(db, two.id)).toBe(true);
    migrateAllToWeeks(db);
    expect(needsWeeks(db, two.id)).toBe(false);
  });

  it("a layer's week is the one most of its passages come from (the earlier on a tie)", () => {
    expect(mainWeek([3, 3, 4])).toBe(3);
    expect(mainWeek([4, 3, 4, 3])).toBe(3);
    expect(mainWeek([])).toBeNull();
  });

  it("the POL101 demo arrives in the syllabus's weeks, every layer written in the new Explained shape, with the brain's notes", () => {
    const seed = demoSeedSchema.parse(JSON.parse(fs.readFileSync(path.join(process.cwd(), "demo", "seed.json"), "utf8")));
    const id = importDemoSeed(db, seed);
    const st = getStructure(db, id)!;
    expect(st.weeks.map((w) => w.week)).toEqual([1, 2, 3]);
    expect(st.weeks.every((w) => w.status === "approved" && w.layers.length >= 2)).toBe(true);
    const layers = st.weeks.flatMap((w) => w.layers);
    expect(layers).toHaveLength(seed.layers.length);
    for (const l of layers) {
      const view = getLayer(db, l.id)!;
      expect(view.contentStatus).toBe("ready");
      expect(isExplainedV2(view.content!.explained)).toBe(true);
      const e = view.content!.explained;
      if (isExplainedV2(e)) {
        expect(e.sections.length).toBeGreaterThanOrEqual(2);
        expect(JSON.stringify(e)).not.toMatch(/"concepts"|"alsoMentioned"/); // no table of terms
      }
    }
    expect(db.select().from(s.brainNotes).where(eq(s.brainNotes.projectId, id)).all().length).toBeGreaterThan(20);
  });
});
