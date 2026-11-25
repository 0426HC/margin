// @vitest-environment node
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { DEMO_SHEET_NAME, demoExamSummary, loadDemoExam } from "@/lib/demo/exam";
import { getExamView, listExams } from "@/lib/exam/service";

// The demo exam: a fictional sheet for the demo course, committed with the demo data, loaded with its summary ready to check.
let db: Db;
beforeAll(() => {
  process.env.MARGIN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "margin-demo-exam-"));
  db = openDb(":memory:").db;
});

describe("the demo exam", () => {
  it("is fictional demo data: the Federalist Papers final, December 14, 2 hours, two parts, Nos. 1, 10 and 51", () => {
    const sheet = fs.readFileSync(path.join("demo", "exam", DEMO_SHEET_NAME), "utf8");
    expect(sheet).toMatch(/fictional exam sheet/i);
    expect(sheet).toContain("5 of the following 8 terms");
    expect(sheet).toMatch(/Marking guide/);
    const sum = demoExamSummary();
    expect(sum).toMatchObject({ date: "December 14", lengthMinutes: 120 });
    expect(sum.sections.map((x) => [x.name, x.format, x.count])).toEqual([
      ["Part I", "short_answer", 5],
      ["Part II", "essay", 1],
    ]);
    expect(sum.terms).toHaveLength(8);
    expect(sum.sampleQuestions).toHaveLength(2);
    expect(sum.topics.join(" ")).toMatch(/1, 10 and 51/);
  });

  it("loads into the demo course once, as a Final whose summary waits for the student to check it", async () => {
    const a = await loadDemoExam(db);
    const project = db.select().from(s.projects).where(eq(s.projects.id, a.projectId)).get()!;
    expect(project.isDemo).toBe(true);
    const view = getExamView(db, a.examId)!;
    expect(view).toMatchObject({ kind: "final", hasSheet: true, sheetName: DEMO_SHEET_NAME, confirmed: false });
    expect(view.summary).toEqual(demoExamSummary());
    const b = await loadDemoExam(db);
    expect(b).toEqual(a);
    expect(listExams(db, a.projectId)).toHaveLength(1);
  });
});
