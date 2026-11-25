// @vitest-environment node
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cannedEngine } from "@/lib/ai/canned";
import { openDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { deleteProject } from "@/lib/projects/delete";
import { addFile, analyzeProject, createProject } from "@/lib/projects/service";
import { getCourseWeeks } from "@/lib/updates/service";
import { getWeekNotes, saveWeekNotes, validWeek, weekSummary } from "@/lib/weeks/notes";

const enc = (t: string) => new TextEncoder().encode(t);
const para = (n: number) => Array.from({ length: n }, (_, i) => `Paragraph ${i} with enough words to count as a real passage of text for the test. `.repeat(6)).join("\n\n");

beforeAll(() => {
  process.env.MARGIN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "margin-weeks-"));
});

describe("lecture notes", () => {
  let db: Db;
  let id: string;
  beforeEach(async () => {
    db = openDb(":memory:").db;
    id = createProject(db, { name: "POL101 Politics" });
    const syllabus = ["# Syllabus", "", "- Week 1 (Sept 2): Why a new government?", "- Week 2 (Sept 9): Faction", "- Week 3: Checks", "- Week 4 (Sept 23): Review", "- Week 5 (Sept 30): Midterm", "- Week 6 (Oct 7): Wrap up"].join("\n");
    await addFile(db, id, { name: "Syllabus.md", relPath: "Syllabus.md", bytes: enc(syllabus) });
    // two different files (the same text twice would be one file copied, and used once)
    await addFile(db, id, { name: "a.txt", relPath: "Week 1/a.txt", bytes: enc(`Week one. ${para(3)}`) });
    await addFile(db, id, { name: "b.txt", relPath: "Week 2/b.txt", bytes: enc(`Week two. ${para(3)}`) });
    await analyzeProject(db, cannedEngine(), id);
  });

  it("the number of weeks follows the course: the syllabus lists six, though only two have files", () => {
    const { count, weeks } = getCourseWeeks(db, id);
    expect(count).toBe(6);
    expect(weeks.map((w) => w.waiting)).toEqual([false, false, true, true, true, true]);
    expect(weekSummary(db, id).map((w) => w.week)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("takes each week's date from the syllabus as written, and has none where it gives none", () => {
    expect(weekSummary(db, id).map((w) => w.date)).toEqual(["Sept 2", "Sept 9", null, "Sept 23", "Sept 30", "Oct 7"]);
  });

  it("stores notes per project per week, and says which weeks have notes", () => {
    expect(weekSummary(db, id).every((w) => !w.hasNotes)).toBe(true);
    saveWeekNotes(db, id, 2, [{ type: "heading", text: "Faction" }, { type: "bullet", text: "factions are bad -> large republic" }]);
    saveWeekNotes(db, id, 4, [{ type: "paragraph", text: "review" }]);
    expect(getWeekNotes(db, id, 2).blocks).toHaveLength(2);
    expect(getWeekNotes(db, id, 3)).toEqual({ blocks: [], updatedAt: null });
    expect(weekSummary(db, id).map((w) => w.hasNotes)).toEqual([false, true, false, true, false, false]);
  });

  it("saving again replaces the page, and a page emptied of text is removed, so it reads 'No notes yet' again", () => {
    saveWeekNotes(db, id, 1, [{ type: "paragraph", text: "first" }]);
    saveWeekNotes(db, id, 1, [{ type: "paragraph", text: "second" }]);
    expect(db.select().from(s.weekNotes).where(eq(s.weekNotes.week, 1)).all()).toHaveLength(1);
    expect(getWeekNotes(db, id, 1).blocks[0].text).toBe("second");
    saveWeekNotes(db, id, 1, [{ type: "paragraph", text: "  " }, { type: "heading", text: "" }]);
    expect(db.select().from(s.weekNotes).all()).toHaveLength(0);
    expect(weekSummary(db, id)[0].hasNotes).toBe(false);
  });

  it("a week is a whole number from 1 to 60", () => {
    expect([0, 1, 12, 60, 61, 2.5, NaN].map(validWeek)).toEqual([false, true, true, true, false, false, false]);
  });

  it("deleting the project deletes its lecture notes with it", () => {
    saveWeekNotes(db, id, 2, [{ type: "paragraph", text: "mine" }]);
    const other = createProject(db, { name: "Other" });
    saveWeekNotes(db, other, 2, [{ type: "paragraph", text: "someone else's course" }]);
    expect(deleteProject(db, id)).toBe(true);
    expect(db.select().from(s.weekNotes).all().map((r) => r.projectId)).toEqual([other]);
  });
});
