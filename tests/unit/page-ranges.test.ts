// @vitest-environment node
/**
 * One file, different pages in different weeks (the Clogg case): a chapter saved in two week folders, with the syllabus giving pp. 7-12
 * to Week 1 and pp. 13-18 to Week 2. The file is stored and read once; each week studies only its own pages. Claude's part is played by
 * scripted answers; the fake engine and a temporary data folder only.
 */
import { and, eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AiRequest } from "@/lib/ai/engine";
import { FakeEngine } from "@/lib/ai/fake-engine";
import { cannedJson } from "@/lib/ai/canned";
import { openDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { checkPages } from "@/lib/import/organize";
import { parseFile } from "@/lib/import/parse";
import { printedOffset } from "@/lib/import/printed-pages";
import { approvePlan, getStructure, passagesByWeek, proposeStructure } from "@/lib/layers/service";
import { weekOfPage } from "@/lib/projects/page-ranges";
import { checkCoursePages, coursesToCheck } from "@/lib/projects/page-ranges-check";
import { addFile, analyzeProject, createProject } from "@/lib/projects/service";
import { getCourseWeeks, placeNewPassages } from "@/lib/updates/service";
import type { CourseFile } from "../fixtures/courses";
import { bookChapterPdf, splitChapter } from "../fixtures/varied-courses";
import { scriptedOrganizer, type ScriptedLabel } from "./helpers/organizer";

let db: Db;
beforeAll(() => {
  process.env.MARGIN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "margin-pages-"));
});
beforeEach(() => {
  db = openDb(":memory:").db;
});

const WEEKS = [1, 2, 3].map((week) => ({ week, date: null, title: ["Ports before empire", "The customs wars", "After the wars"][week - 1], kind: "class" as const, syllabus: "" }));
const label = (p: string, pages: { week: number; from: number; to: number }[]): ScriptedLabel & { pages?: typeof pages } => {
  if (p.endsWith("syllabus.txt")) return { week: null, type: "syllabus" };
  const week = Number(/Week (\d)/.exec(p)![1]);
  return { week, type: "reading", ...(p.includes("Orlen") ? { pages } : {}) };
};
/** Plays Claude: the chapter's pages by week as the syllabus gives them (or none). */
function organizer(pages: { week: number; from: number; to: number }[]) {
  const play = scriptedOrganizer({ isSyllabus: (p) => p.endsWith("syllabus.txt"), weeks: WEEKS, label: (p) => label(p, pages) });
  return (req: AiRequest) => {
    const out = play(req) as { files?: { file: string; pages?: unknown }[] };
    if (req.system.includes("You organise a university student's course folder")) {
      const ids = new Map([...req.prompt.matchAll(/^### (F\d+) \| (.+)$/gm)].map((m) => [m[1], m[2]]));
      out.files = out.files!.map((f) => ({ ...f, pages: ids.get(f.file)!.includes("Orlen") ? pages : [] }));
    }
    return out;
  };
}

async function importCourse(files: CourseFile[], answer: (req: AiRequest) => unknown) {
  const id = createProject(db, { name: "HIS300" });
  for (const f of files) await addFile(db, id, { name: f.relPath.split("/").pop()!, relPath: f.relPath, bytes: f.bytes });
  const engine = new FakeEngine({ json: answer });
  await analyzeProject(db, engine, id);
  return { id, engine };
}
const chapterOf = (id: string) => db.select().from(s.files).where(and(eq(s.files.projectId, id), eq(s.files.category, "course"))).all().find((f) => f.name.includes("Orlen"))!;
/** The chapter's file pages each week holds. */
function chapterPagesByWeek(id: string) {
  const ch = chapterOf(id);
  const pageOf = new Map(db.select({ id: s.passages.id, page: s.passages.page }).from(s.passages).where(eq(s.passages.fileId, ch.id)).all().map((p) => [p.id, p.page]));
  const out = new Map<number, number[]>();
  for (const [week, ps] of passagesByWeek(db, id)) {
    const pages = [...new Set(ps.filter((p) => pageOf.has(p.passageId)).map((p) => pageOf.get(p.passageId)!))].sort((a, b) => a - b);
    if (pages.length) out.set(week, pages);
  }
  return out;
}
/** The chapter's file pages each week's layers hold, after the plan is made. */
function chapterPagesInLayers(id: string) {
  const ch = chapterOf(id);
  const out = new Map<number, number[]>();
  for (const w of getStructure(db, id)!.weeks)
    for (const l of w.layers) {
      const rows = db.select({ page: s.passages.page, fileId: s.passages.fileId }).from(s.layerPassages).innerJoin(s.passages, eq(s.passages.id, s.layerPassages.passageId)).where(eq(s.layerPassages.layerId, l.id)).all();
      const pages = rows.filter((r) => r.fileId === ch.id).map((r) => r.page);
      if (pages.length) out.set(w.week, [...new Set([...(out.get(w.week) ?? []), ...pages])].sort((a, b) => a - b));
    }
  return out;
}
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe("printed page numbers", () => {
  it("finds how far a chapter's printed page numbers run ahead of the PDF's own", async () => {
    const parsed = await parseFile("ch.pdf", bookChapterPdf(7, 12, () => "salt"));
    expect(parsed.printedOffset).toBe(6);
  });
  it("finds none in a file without steady page numbers, so nothing is guessed", () => {
    const pages = Array.from({ length: 6 }, (_, i) => ({ page: i + 1, lines: [{ text: "Chapter heading" }, { text: "In 1770 the war began and lasted until 1831." }, { text: "Plain closing line" }] }));
    expect(printedOffset(pages)).toBeNull();
  });
});

describe("which week a page belongs to", () => {
  it("is the range holding it; a page two weeks claim goes to the narrower range, the earlier week on a tie", () => {
    const ranges = [
      { week: 5, pageFrom: 1, pageTo: 36 },
      { week: 6, pageFrom: 36, pageTo: 44 },
    ];
    expect(weekOfPage(ranges, 3)).toBe(5);
    expect(weekOfPage(ranges, 36)).toBe(6);
    expect(weekOfPage(ranges, 50)).toBeNull();
    expect(weekOfPage([{ week: 2, pageFrom: 1, pageTo: 5 }, { week: 3, pageFrom: 5, pageTo: 9 }], 5)).toBe(2);
  });
});

describe("checking the page ranges Claude gives", () => {
  const span = new Map([["F1", { from: 7, to: 18 }]]);
  it("accepts ranges for two or more of the course's weeks inside the file's printed pages", () => {
    expect(checkPages([{ file: "F1", pages: [{ week: 1, from: 7, to: 12 }, { week: 2, from: 13, to: 18 }] }], new Set([1, 2, 3]), "the weeks you listed", span)).toEqual([]);
  });
  it("names every problem: one week only, a week outside the course, pages outside the file, a backwards range", () => {
    const problems = checkPages(
      [
        { file: "F1", pages: [{ week: 1, from: 7, to: 12 }] },
        { file: "F1", pages: [{ week: 9, from: 7, to: 12 }, { week: 2, from: 40, to: 45 }, { week: 3, from: 12, to: 8 }] },
      ],
      new Set([1, 2, 3]),
      "the weeks you listed",
      span,
    ).join("\n");
    expect(problems).toMatch(/only one week/);
    expect(problems).toMatch(/week 9, which is not one of the weeks you listed/);
    expect(problems).toMatch(/pp\. 40-45, but the file only has pp\. 7-18/);
    expect(problems).toMatch(/run backwards/);
  });
});

describe("importing a course whose syllabus splits one chapter between weeks", () => {
  const SPLIT = [
    { week: 1, from: 7, to: 12 },
    { week: 2, from: 13, to: 18 },
  ];

  it("tells Claude the chapter's printed pages and where its copies sit", async () => {
    const { engine } = await importCourse(await splitChapter(), organizer(SPLIT));
    const prompt = engine.calls.find((c) => c.system.includes("You organise a university student's course folder"))!;
    expect(prompt.system).toContain("One file, different pages in different weeks");
    expect(prompt.prompt).toContain("12 pages (printed page numbers pp. 7-18)");
    expect(prompt.prompt).toContain("The same file is also in the folder as: HIS300/Week 2/Wk 01-02 - Orlen - Salt Roads ch 2.pdf");
  });

  it("stores the file once and gives each week only its own pages, in the layers too", async () => {
    const { id, engine } = await importCourse(await splitChapter(), organizer(SPLIT));
    const files = db.select().from(s.files).where(eq(s.files.projectId, id)).all();
    expect(files.filter((f) => f.name.includes("Orlen") && f.category === "course")).toHaveLength(1);
    const copy = files.find((f) => f.relPath.includes("Wk 01-02"))!;
    expect(copy.category).toBe("duplicate");
    expect(copy.reason).toContain("Week 1: pp. 7–12 · Week 2: pp. 13–18");
    expect(db.select().from(s.filePages).where(eq(s.filePages.projectId, id)).all().map((r) => [r.week, r.printedFrom, r.printedTo, r.pageFrom, r.pageTo])).toEqual([
      [1, 7, 12, 1, 6],
      [2, 13, 18, 7, 12],
    ]);
    // printed pp. 7-12 are the PDF's pages 1-6
    expect(chapterPagesByWeek(id)).toEqual(new Map([[1, range(1, 6)], [2, range(7, 12)]]));
    // the Week 2 counts on the plan screen include the chapter
    expect(getCourseWeeks(db, id).weeks.map((w) => w.files)).toEqual([2, 2, 1]);
    await proposeStructure(db, engine, id);
    expect(chapterPagesInLayers(id)).toEqual(new Map([[1, range(1, 6)], [2, range(7, 12)]]));
    // what Week 2's plan was read from: its pages only
    const week2 = engine.calls.filter((c) => c.system.includes("CHAIN OF IDEAS")).find((c) => c.prompt.includes("Week 2"))!;
    expect(week2.prompt).toContain("page13word");
    expect(week2.prompt).not.toContain("page8word");
  });

  it("still uses an exact copy once, all in one week, when the syllabus doesn't split it", async () => {
    const { id } = await importCourse(await splitChapter(), organizer([]));
    expect(db.select().from(s.filePages).where(eq(s.filePages.projectId, id)).all()).toEqual([]);
    expect(chapterPagesByWeek(id)).toEqual(new Map([[1, range(1, 12)]]));
    expect(db.select().from(s.files).where(eq(s.files.projectId, id)).all().find((f) => f.relPath.includes("Wk 01-02"))!.reason).toBe("The same file as another in the folder, so it is used once.");
  });
});

describe("a course imported before the rule", () => {
  it("is checked once in the background: the moved pages leave their old layer and join the right week", async () => {
    const { id } = await importCourse(await splitChapter(), organizer([]));
    await proposeStructure(db, new FakeEngine({ json: cannedJson }), id);
    approvePlan(db, id);
    expect(chapterPagesInLayers(id)).toEqual(new Map([[1, range(1, 12)]]));
    const week1Layers = getStructure(db, id)!.weeks[0].layers.map((l) => l.id);
    db.update(s.layers).set({ contentStatus: "ready" }).run(); // as if written
    db.update(s.files).set({ pageOffset: null }).run(); // as imported before Margin read printed page numbers
    expect(coursesToCheck(db)).toEqual([id]);

    const engine = new FakeEngine({
      json: (req: AiRequest) => {
        if (req.system.includes("Some files are saved in more than one week folder")) {
          expect(req.prompt).toContain("printed page numbers pp. 7-18"); // read again from the stored file
          const f = /^### (F\d+) \|/m.exec(req.prompt)![1];
          return { files: [{ file: f, pages: [{ week: 1, from: 7, to: 12 }, { week: 2, from: 13, to: 18 }] }] };
        }
        return cannedJson(req);
      },
    });
    const r = await checkCoursePages(db, engine, id, (d, e, p) => placeNewPassages(d, e, p, undefined, { approveNew: true }));
    expect(r.split).toBe(1);
    expect(r.moved).toBeGreaterThanOrEqual(6); // the passages of printed pp. 13-18
    expect(chapterPagesInLayers(id)).toEqual(new Map([[1, range(1, 6)], [2, range(7, 12)]]));
    // the Week 1 layer that lost pages says so; nothing waits for approval
    const marked = db.select().from(s.layers).all().filter((l) => week1Layers.includes(l.id) && l.newMaterialAt !== null);
    expect(marked.length).toBeGreaterThan(0);
    expect(db.select().from(s.layers).all().filter((l) => l.proposed)).toEqual([]);
    expect(coursesToCheck(db)).toEqual([]);
  });

  it("works on a course imported before Margin kept the syllabus's weeks (only a week count)", async () => {
    const { id } = await importCourse(await splitChapter(), organizer([]));
    db.delete(s.courseWeeks).where(eq(s.courseWeeks.projectId, id)).run();
    db.update(s.projects).set({ weekCount: 3 }).where(eq(s.projects.id, id)).run();
    const engine = new FakeEngine({
      json: (req: AiRequest) => {
        expect(req.prompt).toContain("Week 3 | no date | class | (no title)");
        const f = /^### (F\d+) \|/m.exec(req.prompt)![1];
        return { files: [{ file: f, pages: [{ week: 1, from: 7, to: 12 }, { week: 2, from: 13, to: 18 }] }] };
      },
    });
    expect((await checkCoursePages(db, engine, id, async () => {})).split).toBe(1);
  });

  it("is marked checked when the syllabus doesn't split anything, so it runs once", async () => {
    const { id } = await importCourse(await splitChapter(), organizer([]));
    const engine = new FakeEngine({ json: cannedJson });
    expect(await checkCoursePages(db, engine, id, async () => {})).toEqual({ split: 0, moved: 0 });
    expect(coursesToCheck(db)).toEqual([]);
  });
});
