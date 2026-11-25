// @vitest-environment node
import { and, eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cannedEngine } from "@/lib/ai/canned";
import { openDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { getStructure, refreshLayer, writeLayerContent } from "@/lib/layers/service";
import { addFile, sha256 } from "@/lib/projects/service";
import { FakeEngine } from "@/lib/ai/fake-engine";
import type { FileType } from "@/lib/projects/file-kinds";
import { examKindOf } from "@/lib/updates/classify";
import { diffFolder } from "@/lib/updates/diff";
import { approveProposals, commitFiles, compareFolder, fallbackPlacement, getCourseWeeks, getPending, inspectFile, labelNewFiles, placeNewPassages, shareOut, validatePlacement } from "@/lib/updates/service";
import { weekOfUnit } from "@/lib/updates/weeks";
import { makeApprovedProject } from "./helpers/course";

const enc = (t: string) => new TextEncoder().encode(t);
let seed = 0;
const words = (n: number) => Array.from({ length: n }, () => `nw${++seed}z`).join(" ");
const paragraphs = (n: number) => Array.from({ length: n }, () => words(60)).join("\n\n");

beforeAll(() => {
  process.env.MARGIN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "margin-upd-"));
});

describe("comparing a folder with what the project has", () => {
  const stored = (id: string, relPath: string, hash: string | null, absent = false) => ({ id, relPath, hash, absent });
  const picked = (relPath: string, hash: string) => ({ relPath, hash });

  it("sorts files into new, changed, removed and unchanged by path and content hash", () => {
    const d = diffFolder(
      [stored("1", "Week 1/a.pdf", "h1"), stored("2", "Week 2/b.pdf", "h2"), stored("3", "Week 3/c.pdf", "h3")],
      [picked("Week 1/a.pdf", "h1"), picked("Week 2/b.pdf", "CHANGED"), picked("Week 4/d.pdf", "h4")],
    );
    expect(d.unchanged).toBe(1);
    expect(d.changed.map((c) => c.storedId)).toEqual(["2"]);
    expect(d.added.map((a) => a.relPath)).toEqual(["Week 4/d.pdf"]);
    expect(d.removed.map((r) => r.id)).toEqual(["3"]);
  });

  it("matches a picked folder's own name with or without the root the earlier import kept", () => {
    const d = diffFolder([stored("1", "POL101/Week 1/a.pdf", "h1"), stored("2", "Week 2/b.pdf", "h2"), stored("3", "c.pdf", "h3")], [picked("POL101/Week 1/a.pdf", "h1"), picked("POL101/Week 2/b.pdf", "h2"), picked("POL101/c.pdf", "h3")]);
    expect(d).toMatchObject({ added: [], changed: [], removed: [], unchanged: 3 });
  });

  it("a file with no stored hash is judged by its path alone", () => {
    expect(diffFolder([stored("1", "a.pdf", null)], [picked("a.pdf", "anything")]).unchanged).toBe(1);
  });

  it("a moved or renamed file is the same file, not a new one plus a removed one", () => {
    const d = diffFolder([stored("1", "Week 1/a.pdf", "h1")], [picked("Week 5/a-renamed.pdf", "h1")]);
    expect(d).toMatchObject({ added: [], removed: [], unchanged: 1 });
  });

  it("a file the student chose to keep after it left the folder is not listed as removed again", () => {
    expect(diffFolder([stored("1", "a.pdf", "h1", true)], []).removed).toEqual([]);
  });
});

describe("naming an exam and reading unit titles", () => {
  it("calls an exam Midterm or Final when its name or first words say so", () => {
    expect(examKindOf("Midterm exam instructions.pdf")).toBe("midterm");
    expect(examKindOf("info.docx", "Final examination. Time allowed: 2 hours.")).toBe("final");
    expect(examKindOf("sheet.pdf", "Instructions for the test.")).toBe("exam");
  });
  it("reads the week number of a unit", () => {
    expect(weekOfUnit("Week 3: Checks and balances")).toBe(3);
    expect(weekOfUnit("Module 07")).toBe(7);
    expect(weekOfUnit("Chapter 2")).toBeNull();
  });
});

describe("sharing out passages and checking a placement", () => {
  it("gives each old layer a share in proportion to what it held", () => {
    expect(shareOut(10, [3, 7])).toEqual([3, 7]);
    expect(shareOut(4, [1, 1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(4);
    expect(shareOut(3, [9, 1, 1])).toEqual([1, 1, 1]); // everyone keeps at least one when there are enough
    expect(shareOut(2, [5, 5, 5]).reduce((a, b) => a + b, 0)).toBe(2);
  });
  const g = (layer: number, from: number, to: number, title = "", q = "") => ({ layer, title, bigQuestion: q, buildsOn: "", ranges: [{ from, to }] });
  it("needs every new passage in exactly one group, real layer numbers, and a question for a new layer", () => {
    expect(validatePlacement({ placements: [g(1, 1, 2), g(0, 3, 3, "New topic", "What is new?")] }, 3, 2)).toEqual([]);
    expect(validatePlacement({ placements: [g(1, 1, 2)] }, 3, 2).join(" ")).toMatch(/not in any group/);
    expect(validatePlacement({ placements: [g(1, 1, 2), g(2, 2, 3)] }, 3, 2).join(" ")).toMatch(/more than one group/);
    expect(validatePlacement({ placements: [g(5, 1, 3)] }, 3, 2).join(" ")).toMatch(/only layers 1 to 2/);
    expect(validatePlacement({ placements: [g(0, 1, 3, "T", "no question")] }, 3, 2).join(" ")).toMatch(/needs a title and a big question/);
  });
  it("the plain placement joins the layer that holds most of the unit, and starts one new layer per file otherwise", () => {
    const p = fallbackPlacement([{ n: 1, unitId: "u1", file: "a.txt" }, { n: 2, unitId: "u1", file: "a.txt" }, { n: 3, unitId: "u9", file: "b.txt" }], new Map([["u1", 2]]));
    expect(p.placements).toMatchObject([{ layer: 2, ranges: [{ from: 1, to: 2 }] }, { layer: 0, title: "New material (b)", ranges: [{ from: 3, to: 3 }] }]);
    expect(validatePlacement(p, 3, 2)).toEqual([]);
  });
});

describe("adding files to a course that already has layers", () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(":memory:").db;
  });

  const stage = async (id: string, name: string, relPath: string, text: string, extra: { type?: FileType; week?: number | null } = {}) =>
    (await addFile(db, id, { name, relPath, bytes: enc(text), label: { type: extra.type ?? "reading", week: extra.week ?? null, reason: null, check: false } })).id;
  const unitsOf = (id: string) => db.select().from(s.units).where(eq(s.units.projectId, id)).all().sort((a, b) => a.position - b.position).map((u) => u.title);
  const saveWriteup = (layerId: string) => {
    const wb = "wb1";
    db.insert(s.writebacks).values({ id: wb, targetType: "layer", targetId: layerId, text: "My own words." }).run();
    db.insert(s.noteSaves).values({ id: "ns1", targetType: "layer", targetId: layerId, writebackId: wb, version: "own", text: "My own words." }).run();
  };
  const noteRows = () => db.select().from(s.noteSaves).all();

  it("puts a new file in its week, adds its passages to the layer that covers that week and marks only that layer", async () => {
    const { id, layers } = await makeApprovedProject(db);
    for (const l of layers()) await writeLayerContent(db, cannedEngine(), l.id);
    const before = Object.fromEntries(layers().map((l) => [l.id, l.passages]));
    const week2Layer = db.select({ layerId: s.layerPassages.layerId }).from(s.layerPassages).innerJoin(s.passages, eq(s.passages.id, s.layerPassages.passageId)).innerJoin(s.sections, eq(s.sections.id, s.passages.sectionId)).innerJoin(s.units, eq(s.units.id, s.sections.unitId)).where(eq(s.units.title, "Week 2: Faction")).get()!.layerId;
    saveWriteup(week2Layer);
    const fileId = await stage(id, "extra.txt", "extra.txt", paragraphs(4), { week: 2, type: "reading" });

    const c = commitFiles(db, id, { staged: [{ fileId }], removals: [] });
    expect(c.added).toEqual([fileId]);
    const placed = await placeNewPassages(db, cannedEngine(), id);
    expect(placed.proposed).toEqual([]);
    expect(placed.toLayers.map((t) => t.layerId)).toEqual([week2Layer]);

    const after = layers();
    const grew = after.filter((l) => l.passages > before[l.id]);
    expect(grew.map((l) => l.id)).toEqual([week2Layer]);
    expect(after.filter((l) => l.newMaterial).map((l) => l.id)).toEqual([week2Layer]);
    expect(unitsOf(id)).toContain("Week 2: Faction");
    expect(db.select({ w: s.files.week }).from(s.files).where(eq(s.files.id, fileId)).get()!.w).toBe(2);
    expect(noteRows()).toHaveLength(1); // the saved write-up is exactly as it was
    expect(noteRows()[0].text).toBe("My own words.");
    expect(getPending(db, id)).toMatchObject({ unplaced: 0, proposed: [] });
  });

  it("makes a unit for a week the course doesn't have yet, in order", async () => {
    const { id } = await makeApprovedProject(db);
    const fileId = await stage(id, "w6.txt", "w6.txt", paragraphs(3), { week: 6 });
    commitFiles(db, id, { staged: [{ fileId }], removals: [] });
    const titles = unitsOf(id);
    expect(titles.map((t) => weekOfUnit(t))).toEqual([1, 2, 3, 4, 6]);
  });

  it("a new topic becomes a proposed layer that is not in the course until approved, then lands where its material sits", async () => {
    const { id, layers } = await makeApprovedProject(db);
    const count = layers().length;
    const fileId = await stage(id, "new topic.txt", "new topic.txt", paragraphs(5), { week: 2 });
    commitFiles(db, id, { staged: [{ fileId }], removals: [] });
    const placed = await placeNewPassages(db, cannedEngine(), id);
    expect(placed.proposed).toHaveLength(1);
    expect(layers()).toHaveLength(count); // not part of the course yet
    expect(getStructure(db, id)!.weeks.flatMap((w) => w.layers).some((l) => l.title === "new topic")).toBe(false);
    const pending = getPending(db, id);
    expect(pending.proposed[0]).toMatchObject({ title: "new topic", files: ["new topic.txt"] });

    approveProposals(db, id, [{ layerId: pending.proposed[0].id, action: "approve", title: "A better title" }]);
    expect(layers()).toHaveLength(count + 1);
    expect(layers().map((l) => l.title)).toContain("A better title");
    expect(getPending(db, id).proposed).toEqual([]);
    // the layers still number 0..n-1 within their week
    for (const p of db.select().from(s.parts).where(eq(s.parts.projectId, id)).all()) {
      const ps = db.select().from(s.layers).where(and(eq(s.layers.partId, p.id), eq(s.layers.proposed, false))).all().map((l) => l.position).sort((a, b) => a - b);
      expect(ps).toEqual(ps.map((_, i) => i));
    }
  });

  it("a proposed layer can be merged into an existing one instead", async () => {
    const { id, layers } = await makeApprovedProject(db);
    const count = layers().length;
    const target = layers()[0];
    const fileId = await stage(id, "new topic.txt", "new topic.txt", paragraphs(3), { week: 3 });
    commitFiles(db, id, { staged: [{ fileId }], removals: [] });
    await placeNewPassages(db, cannedEngine(), id);
    const p = getPending(db, id).proposed[0];
    approveProposals(db, id, [{ layerId: p.id, action: "merge", mergeInto: target.id }]);
    expect(layers()).toHaveLength(count);
    expect(layers()[0].passages).toBeGreaterThan(target.passages);
    expect(db.select().from(s.layers).where(eq(s.layers.id, p.id)).get()).toBeUndefined();
  });

  it("a changed file replaces the old one in the same layers, and the write-up stays", async () => {
    const { id, layers } = await makeApprovedProject(db);
    for (const l of layers()) await writeLayerContent(db, cannedEngine(), l.id);
    const old = db.select().from(s.files).where(eq(s.files.name, "b.txt")).get()!;
    const holders = db.select({ l: s.layerPassages.layerId }).from(s.layerPassages).innerJoin(s.passages, eq(s.passages.id, s.layerPassages.passageId)).where(eq(s.passages.fileId, old.id)).all().map((r) => r.l);
    saveWriteup(holders[0]);
    const total = db.select().from(s.layerPassages).all().length;
    const fileId = await stage(id, "b.txt", old.relPath, paragraphs(20));
    const c = commitFiles(db, id, { staged: [{ fileId, replaces: old.id }], removals: [] });
    expect(c.replaced).toEqual([fileId]);
    expect(db.select().from(s.files).where(eq(s.files.id, old.id)).get()).toBeUndefined();
    expect(db.select().from(s.layerPassages).all().length).toBe(total); // same text length, every passage in a layer
    expect(getPending(db, id).unplaced).toBe(0);
    expect(new Set(layers().filter((l) => l.newMaterial).map((l) => l.id))).toEqual(new Set(holders));
    expect(noteRows()[0].text).toBe("My own words.");
  });

  it("a removed file can be kept (its passages stay and it is not listed again) or removed (a layer left empty goes unless the student wrote in it)", async () => {
    const { id, layers } = await makeApprovedProject(db);
    const d = db.select().from(s.files).where(eq(s.files.name, "d.txt")).get()!;
    const c0 = db.select().from(s.files).where(eq(s.files.name, "c.txt")).get()!;
    const passagesBefore = db.select().from(s.passages).all().length;
    expect(commitFiles(db, id, { staged: [], removals: [{ fileId: d.id, keep: true }] })).toMatchObject({ kept: 1, removed: 0 });
    expect(db.select().from(s.passages).all().length).toBe(passagesBefore);
    expect(compareFolder(db, id, []).removed.map((r) => r.name)).not.toContain("d.txt");

    const countBefore = layers().length;
    const r = commitFiles(db, id, { staged: [], removals: [{ fileId: c0.id, keep: false }] });
    expect(r.removed).toBe(1);
    expect(db.select().from(s.passages).where(eq(s.passages.fileId, c0.id)).all()).toHaveLength(0);
    expect(layers().length).toBeLessThanOrEqual(countBefore);

    // a layer that has the student's write-up is never deleted, even when it has no text left
    const withWork = layers().find((l) => db.select().from(s.layerPassages).where(eq(s.layerPassages.layerId, l.id)).all().length > 0)!;
    saveWriteup(withWork.id);
    const files = db.select().from(s.files).where(eq(s.files.projectId, id)).all();
    const res = commitFiles(db, id, { staged: [], removals: files.map((f) => ({ fileId: f.id, keep: false })) });
    expect(res.emptiedLayers).toContain(withWork.id);
    expect(db.select().from(s.layers).where(eq(s.layers.id, withWork.id)).get()).toBeDefined();
    expect(noteRows()).toHaveLength(1);
  });

  it("an exam instruction sheet is stored but never cut into sections or put in a layer", async () => {
    const { id, layers } = await makeApprovedProject(db);
    const total = db.select().from(s.passages).all().length;
    const examId = await stage(id, "Midterm exam instructions.txt", "Midterm exam instructions.txt", "Exam instructions. Time allowed: 2 hours. Marking guide. Section A: multiple choice.", { type: "exam" });
    const c = commitFiles(db, id, { staged: [{ fileId: examId }], removals: [] });
    expect(c.examSheets).toMatchObject([{ id: examId, kind: "midterm" }]);
    const row = db.select().from(s.files).where(eq(s.files.id, examId)).get()!;
    expect(row).toMatchObject({ role: "exam", unitId: null });
    expect(row.parsed?.length).toBeGreaterThan(0);
    expect(db.select().from(s.passages).all()).toHaveLength(total);
    expect(layers().every((l) => !l.newMaterial)).toBe(true);
    expect(getCourseWeeks(db, id).weeks.reduce((n, w) => n + w.files, 0)).toBe(4); // not counted as a week's file
  });

  it("Refresh this layer writes Explained again, clears the marker and leaves the write-up alone", async () => {
    const { id, layers } = await makeApprovedProject(db);
    const first = layers()[0];
    await writeLayerContent(db, cannedEngine(), first.id);
    saveWriteup(first.id);
    db.update(s.layers).set({ newMaterialAt: Date.now() }).where(eq(s.layers.id, first.id)).run();
    expect(layers()[0].newMaterial).toBe(true);
    const engine = cannedEngine();
    await refreshLayer(db, engine, first.id);
    expect(layers()[0].newMaterial).toBe(false);
    expect(layers()[0].contentStatus).toBe("ready");
    expect(noteRows()).toHaveLength(1);
    expect(db.select().from(s.writebacks).all()).toHaveLength(1);
    void id;
  });

  it("compares a folder by hash without calling any AI, and hashes files imported before hashes were kept", async () => {
    const { id } = await makeApprovedProject(db);
    const a = db.select().from(s.files).where(eq(s.files.name, "a.txt")).get()!;
    expect(a.contentHash).toBe(sha256(fs.readFileSync(a.storedPath!)));
    db.update(s.files).set({ contentHash: null }).where(eq(s.files.id, a.id)).run(); // an older import
    const cmp = compareFolder(db, id, [{ name: "a.txt", relPath: a.relPath, hash: sha256(fs.readFileSync(a.storedPath!)) }]);
    expect(cmp.unchanged).toBe(1);
    expect(db.select().from(s.files).where(eq(s.files.id, a.id)).get()!.contentHash).toBe(sha256(fs.readFileSync(a.storedPath!)));
    expect(cmp.removed.map((r) => r.name).sort()).toEqual(["b.txt", "c.txt", "d.txt"]);
  });

  it("looks at a file in memory: measures it for Claude and stores nothing", async () => {
    const { id } = await makeApprovedProject(db);
    const files = db.select().from(s.files).all().length;
    const r = await inspectFile({ name: "Lecture 3 slides.txt", relPath: "Week 3/Lecture 3 slides.txt", bytes: enc(paragraphs(2)) });
    expect(r).toMatchObject({ ok: true, words: 120, facts: { format: "Text", words: 120 } });
    expect(await inspectFile({ name: "x.xyz", relPath: "x.xyz", bytes: enc("hi") })).toMatchObject({ ok: false });
    expect(db.select().from(s.files).all()).toHaveLength(files);
    void id;
  });

  it("new files are labelled by Claude against the course's own weeks, files and syllabus; a week outside the course is sent back once", async () => {
    const { id } = await makeApprovedProject(db);
    const facts = (await inspectFile({ name: "Binder.txt", relPath: "POL101/Binder.txt", bytes: enc(paragraphs(3)) })) as Extract<Awaited<ReturnType<typeof inspectFile>>, { ok: true }>;
    let n = 0;
    const engine = new FakeEngine({
      json: () => ({
        courseCode: null,
        weeks: [],
        files: [{ file: "F1", week: n++ === 0 ? 9 : 3, type: "reading", confidence: "check", reason: "Not in the syllabus; its topic fits Week 3." }],
        missingReadings: [],
        notInSyllabus: ["F1"],
      }),
    });
    const r = await labelNewFiles(db, engine, id, [{ relPath: "POL101/Binder.txt", facts: facts.facts }]);
    expect(r).toEqual({ ok: true, labels: { "POL101/Binder.txt": { week: 3, type: "reading", check: true, reason: "Not in the syllabus; its topic fits Week 3.", pages: [] } } });
    expect(engine.calls).toHaveLength(2); // no syllabus pick: the course's stored syllabus is used
    expect(engine.calls[1].prompt).toContain("week 9, which is not one of the course's existing weeks");
    expect(engine.calls[0].prompt).toContain("Week 1 - Foundations/a.txt | reading | 1"); // the files it already holds
    expect(engine.calls[0].prompt).toContain("Binder.txt (NEW)");
    expect(engine.calls[0].system).toContain("Label only the new files");
  });
});
