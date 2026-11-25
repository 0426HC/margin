// @vitest-environment node
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cannedEngine } from "@/lib/ai/canned";
import { openDb, type Db } from "@/lib/db/client";
import { searchPassages } from "@/lib/db/search";
import * as s from "@/lib/db/schema";
import { addFile, analyzeProject, createProject, getReview, mergeUnits, moveFile, removeFile, renameUnit } from "@/lib/projects/service";
import { makePdf } from "../fixtures/build";

const enc = (t: string) => new TextEncoder().encode(t);
let seed = 0;
const words = (n: number) => Array.from({ length: n }, () => `zq${++seed}x`).join(" ");
/** A hard-wrapped text file: n paragraphs of about 60 words each, wrapped at ~10 words a line, with one hyphenated break. */
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
  process.env.MARGIN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "margin-svc-"));
});
beforeEach(() => {
  db = openDb(":memory:").db;
  projectId = createProject(db, { name: "POL101 Politics" });
});

async function importCourse() {
  const src = {
    syllabus: `# Syllabus\n\n${wrapped(2)}`,
    w1: `FEDERALIST No. 1\n\nGeneral Introduction\n\n${wrapped(30)}\n\nFEDERALIST No. 2\n\nConcerning Dangers\n\n${wrapped(30)}`,
    w2: wrapped(8),
  };
  await addFile(db, projectId, { name: "POL101 Syllabus F26.md", relPath: "POL101 Syllabus F26.md", bytes: enc(src.syllabus) });
  await addFile(db, projectId, { name: "fed.txt", relPath: "Week 1 - Foundations/fed.txt", bytes: enc(src.w1) });
  await addFile(db, projectId, { name: "w2.txt", relPath: "Week 2/w2.txt", bytes: enc(src.w2) });
  await analyzeProject(db, cannedEngine(), projectId);
  return src;
}

describe("import service", () => {
  it("detects units, cuts files into sections, and names the course code", async () => {
    await importCourse();
    const r = getReview(db, projectId)!;
    expect(r.units.map((u) => u.title)).toEqual(["Course overview", "Week 1: Foundations", "Week 2"]);
    expect(r.units[1].files[0].sections.map((x) => x.title)).toEqual(["FEDERALIST No. 1: General Introduction", "FEDERALIST No. 2: Concerning Dangers"]);
    expect(r.project).toMatchObject({ status: "building", courseCode: "POL101" }); // no separate unit review: the plan comes next
  });

  it("stores each file's text verbatim: its sections joined equal the source after whitespace and hyphen normalisation", async () => {
    const src = await importCourse();
    const norm = (t: string) => t.replace(/-\s*\n\s*(?=[a-z])/g, "").replace(/^#+\s+/gm, "").split(/\s+/).filter(Boolean).join(" ");
    const file = db.select().from(s.files).where(eq(s.files.name, "fed.txt")).get()!;
    const secs = db.select().from(s.sections).where(eq(s.sections.fileId, file.id)).orderBy(s.sections.position).all();
    expect(secs.length).toBe(2);
    const joined = secs.flatMap((x) => x.original.map((b) => b.text)).join(" ");
    expect(norm(joined)).toBe(norm(src.w1));
  });

  it("keeps passages on the right page: a unique word is found on the page its text sits on", async () => {
    await importCourse();
    const file = db.select().from(s.files).where(eq(s.files.name, "w2.txt")).get()!;
    const sec = db.select().from(s.sections).where(eq(s.sections.fileId, file.id)).get()!;
    for (const b of sec.original) {
      const probe = b.text.split(" ")[3]; // a unique token inside this block
      const hit = searchPassages(db, projectId, probe, 1)[0];
      expect(hit, probe).toMatchObject({ file: "w2.txt", page: b.page, sectionId: sec.id });
    }
    const pages = db.select().from(s.passages).where(eq(s.passages.sectionId, sec.id)).all();
    expect(pages.every((p) => p.page >= sec.pageStart && p.page <= sec.pageEnd)).toBe(true);
  });

  it("marks an unreadable file failed with a reason, and still imports the rest", async () => {
    await addFile(db, projectId, { name: "ok.txt", relPath: "Week 1/ok.txt", bytes: enc(wrapped(10)) });
    const bad = await addFile(db, projectId, { name: "broken.pdf", relPath: "Week 1/broken.pdf", bytes: enc("not a pdf") });
    const scan = await addFile(db, projectId, { name: "scan.pdf", relPath: "Week 1/scan.pdf", bytes: makePdf([[{ text: "" }]]) });
    const odd = await addFile(db, projectId, { name: "sheet.xlsx", relPath: "Week 1/sheet.xlsx", bytes: enc("x") });
    expect(bad).toMatchObject({ status: "failed", error: expect.stringMatching(/can't be read/) });
    expect(scan.error).toMatch(/scanned/);
    expect(odd.error).toMatch(/isn't a type Margin reads/);
    await analyzeProject(db, cannedEngine(), projectId);
    const r = getReview(db, projectId)!;
    expect(r.units).toHaveLength(1);
    expect(r.units[0].files.map((f) => f.name)).toEqual(["ok.txt"]);
    expect(r.failed.map((f) => f.name).sort()).toEqual(["broken.pdf", "scan.pdf", "sheet.xlsx"]);
  });

  it("stores a file's name without its folders, whatever the upload called it", async () => {
    const row = await addFile(db, projectId, { name: "Course/Week 1/w2.txt", relPath: "Course/Week 1/w2.txt", bytes: enc(wrapped(3)) });
    expect(row.name).toBe("w2.txt");
    expect(row.relPath).toBe("Course/Week 1/w2.txt");
    const win = await addFile(db, projectId, { name: "Course\\Week 2\\more.txt", relPath: "Course/Week 2/more.txt", bytes: enc(wrapped(3)) });
    expect(win.name).toBe("more.txt");
  });

  it("flags a PDF whose text looks like a poor scan, and not a clean one", async () => {
    const noisy = Array.from({ length: 12 }, () => ({ text: "Tbe rnain @ spr1ngs ~ of acti0n | ar3 j r ' wlth brok3n w0rds f# &x" }));
    const clean = Array.from({ length: 12 }, () => ({ text: "Among the numerous advantages promised by a well constructed Union, none deserves to be more" }));
    await addFile(db, projectId, { name: "Week 1 scan.pdf", relPath: "Week 1/scan.pdf", bytes: makePdf([noisy, noisy, noisy]) });
    await addFile(db, projectId, { name: "Week 1 clean.pdf", relPath: "Week 1/clean.pdf", bytes: makePdf([clean, clean, clean]) });
    await addFile(db, projectId, { name: "w2.txt", relPath: "Week 1/w2.txt", bytes: enc(wrapped(3)) });
    await analyzeProject(db, cannedEngine(), projectId);
    const files = Object.fromEntries(getReview(db, projectId)!.units[0].files.map((f) => [f.name, f]));
    expect(files["Week 1 scan.pdf"].lowQuality).toBe(true);
    expect(files["Week 1 scan.pdf"].textQuality).toBeLessThan(0.7);
    expect(files["Week 1 clean.pdf"].lowQuality).toBe(false);
    expect(files["w2.txt"]).toMatchObject({ lowQuality: false, textQuality: null }); // only PDFs are scored
  });

  it("analyzing twice replaces the first result instead of doubling it", async () => {
    await importCourse();
    await analyzeProject(db, cannedEngine(), projectId);
    expect(db.select().from(s.units).all()).toHaveLength(3);
    const count = (db.select().from(s.sections).all()).length;
    await analyzeProject(db, cannedEngine(), projectId);
    expect(db.select().from(s.sections).all()).toHaveLength(count);
  });
});

describe("review edits", () => {
  it("renames a unit", async () => {
    await importCourse();
    const u = getReview(db, projectId)!.units[2];
    renameUnit(db, u.id, "  Week 2: Faction ");
    expect(getReview(db, projectId)!.units[2].title).toBe("Week 2: Faction");
  });

  it("moves a file with its sections, and removes the unit it leaves empty", async () => {
    await importCourse();
    const r = getReview(db, projectId)!;
    moveFile(db, r.units[2].files[0].id, r.units[1].id);
    const after = getReview(db, projectId)!;
    expect(after.units.map((u) => u.title)).toEqual(["Course overview", "Week 1: Foundations"]);
    expect(after.units[1].files.map((f) => f.name)).toEqual(["fed.txt", "w2.txt"]);
    const unit = db.select().from(s.units).where(eq(s.units.title, "Week 1: Foundations")).get()!;
    const positions = db.select().from(s.sections).where(eq(s.sections.unitId, unit.id)).all().map((x) => x.position).sort((a, b) => a - b);
    expect(positions).toEqual(positions.map((_, i) => i));
  });

  it("merges two units", async () => {
    await importCourse();
    const r = getReview(db, projectId)!;
    mergeUnits(db, r.units[2].id, r.units[1].id);
    const after = getReview(db, projectId)!;
    expect(after.units.map((u) => u.title)).toEqual(["Course overview", "Week 1: Foundations"]);
    expect(after.units[1].files).toHaveLength(2);
  });

  it("removes a file, its sections, its passages and its stored copy", async () => {
    await importCourse();
    const file = db.select().from(s.files).where(eq(s.files.name, "w2.txt")).get()!;
    const stored = file.storedPath!;
    expect(fs.existsSync(stored)).toBe(true);
    const probe = db.select().from(s.sections).where(eq(s.sections.fileId, file.id)).get()!.original[0].text.split(" ")[2];
    expect(searchPassages(db, projectId, probe, 3)).not.toHaveLength(0);
    removeFile(db, file.id);
    expect(searchPassages(db, projectId, probe, 3)).toEqual([]);
    expect(fs.existsSync(stored)).toBe(false);
    expect(getReview(db, projectId)!.units.map((u) => u.title)).toEqual(["Course overview", "Week 1: Foundations"]);
  });
});
