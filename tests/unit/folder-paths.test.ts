import { describe, expect, it } from "vitest";
import { folderOf, stripCommonRoot } from "@/lib/import/paths";

describe("stripCommonRoot", () => {
  it("drops the dropped folder's own name when every file sits inside it", () => {
    expect(stripCommonRoot(["Course/Week 1/a.pdf", "Course/syllabus.md"])).toEqual(["Week 1/a.pdf", "syllabus.md"]);
  });
  it("leaves paths alone when they do not share a root", () => {
    expect(stripCommonRoot(["Week 1/a.pdf", "Week 2/b.pdf"])).toEqual(["Week 1/a.pdf", "Week 2/b.pdf"]);
    expect(stripCommonRoot(["a.pdf", "Week 2/b.pdf"])).toEqual(["a.pdf", "Week 2/b.pdf"]);
  });
  it("leaves bare file names alone", () => {
    expect(stripCommonRoot(["a.pdf", "b.pdf"])).toEqual(["a.pdf", "b.pdf"]);
  });
});

describe("folderOf", () => {
  it("returns the folders above a file, or an empty string", () => {
    expect(folderOf("Week 1/Readings/a.pdf")).toBe("Week 1/Readings");
    expect(folderOf("a.pdf")).toBe("");
  });
});
