import { describe, expect, it } from "vitest";
import { detectCourseCode, detectUnits } from "@/lib/import/detect-units";

const files = (...paths: string[]) => paths.map((relPath, i) => ({ id: `f${i}`, relPath }));
const byTitle = (r: ReturnType<typeof detectUnits>) => Object.fromEntries(r.map((u) => [u.title, u.fileIds.length]));

describe("detectUnits", () => {
  it("reads 'Wk03' as Week 3", () => {
    const r = detectUnits(files("Wk03 reading.pdf"));
    expect(r.map((u) => u.title)).toEqual(["Week 3"]);
  });

  it("reads 'Lecture_12 slides' as Lecture 12", () => {
    expect(detectUnits(files("Lecture_12 slides.pptx"))[0].title).toBe("Lecture 12");
  });

  it("sends 'POL101 Syllabus F26' to the Course overview", () => {
    const r = detectUnits(files("POL101 Syllabus F26.pdf", "Week 1/a.pdf"));
    expect(r[0]).toMatchObject({ title: "Course overview", isOverview: true, fileIds: ["f0"] });
  });

  it("lets the folder win over the file name", () => {
    const r = detectUnits(files("Week 3 - Readings/ch2.pdf", "Week 3 - Readings/Lecture 7.pdf"));
    expect(byTitle(r)).toEqual({ "Week 3: Readings": 2 });
  });

  it("reads 'Module02' and 'session 4b'", () => {
    const r = detectUnits(files("Module02.docx", "session 4b notes.txt", "session 4 slides.pptx"));
    expect(byTitle(r)).toEqual({ "Module 2": 1, "Session 4": 2 });
  });

  it("does not merge Week 10 with Week 1, and sorts by number", () => {
    const r = detectUnits(files("Week 10 vs Week 1.pdf", "Week 1/x.pdf", "Week 2/y.pdf"));
    expect(r.map((u) => u.title)).toEqual(["Week 1", "Week 2", "Week 10"]);
  });

  it("puts a file with no number in Misc, last, and never drops it", () => {
    const r = detectUnits(files("glossary.md", "Week 1/a.pdf"));
    expect(r.map((u) => u.title)).toEqual(["Week 1", "Misc"]);
    expect(r.flatMap((u) => u.fileIds).sort()).toEqual(["f0", "f1"]);
  });

  it("ignores the dropped root folder's own name", () => {
    const r = detectUnits(files("Course Week Pack/Week 1/a.pdf", "Course Week Pack/Week 2/b.pdf"));
    expect(r.map((u) => u.title)).toEqual(["Week 1", "Week 2"]);
  });

  it("puts the overview first", () => {
    const r = detectUnits(files("Week 1/a.pdf", "syllabus.pdf"));
    expect(r.map((u) => u.title)).toEqual(["Course overview", "Week 1"]);
  });
});

describe("detectCourseCode", () => {
  it("finds a course code in the file names", () => {
    expect(detectCourseCode(["POL101 Syllabus F26.pdf", "Week 1/a.pdf"])).toBe("POL101");
  });
  it("returns undefined when there is none", () => {
    expect(detectCourseCode(["Week 1/a.pdf"])).toBeUndefined();
  });
});
