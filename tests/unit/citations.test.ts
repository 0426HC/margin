/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { invalidCitations, splitCitations, stripInvalidCitations } from "@/lib/ai/citations";

describe("splitCitations", () => {
  it("splits text and [file, p. N] citations in order", () => {
    const parts = splitCitations("A faction is a group. [federalist-papers.pdf, p. 39] It can be a majority. [federalist-papers.pdf, p. 40]");
    expect(parts).toHaveLength(4);
    expect(parts[1]).toEqual({ cite: { file: "federalist-papers.pdf", page: 39, raw: "[federalist-papers.pdf, p. 39]" } });
    expect(parts[3]).toMatchObject({ cite: { page: 40 } });
  });
  it("leaves text with no citations alone", () => {
    expect(splitCitations("No sources here.")).toEqual([{ text: "No sources here." }]);
  });
  it("does not treat other brackets as citations", () => {
    expect(splitCitations("See [1] and [note, later]")).toEqual([{ text: "See [1] and [note, later]" }]);
  });
});

describe("citation parsing edge cases", () => {
  it("handles a file name with commas and square brackets", () => {
    const [, c] = splitCitations("See [Reader, vol. 2 [2024].pdf, p. 3] for this.");
    expect(c).toEqual({ cite: { file: "Reader, vol. 2 [2024].pdf", page: 3, raw: "[Reader, vol. 2 [2024].pdf, p. 3]" } });
  });
  it("handles several citations in one sentence", () => {
    const parts = splitCitations("Both agree [a.pdf, p. 1][b.pdf, p. 22], though not fully [a.pdf, p. 2].");
    expect(parts.filter((p) => "cite" in p).map((p: any) => p.cite.page)).toEqual([1, 22, 2]);
  });
});

describe("validating citations against what was sent", () => {
  const sent = [{ file: "a.pdf", page: 1 }, { file: "b.pdf", page: 22 }];
  it("accepts citations that were sent", () => {
    expect(invalidCitations("Yes [a.pdf, p. 1] and [b.pdf, p. 22].", sent)).toEqual([]);
  });
  it("flags a wrong page and an unknown file", () => {
    expect(invalidCitations("No [a.pdf, p. 2] and [c.pdf, p. 1].", sent)).toEqual(["[a.pdf, p. 2]", "[c.pdf, p. 1]"]);
  });
  it("strips citations that point at nothing, keeps the valid ones, and reports what it stripped", () => {
    const out = stripInvalidCitations("Faction is a group [a.pdf, p. 1]. It is bad [a.pdf, p. 99].", sent);
    expect(out.text).toBe("Faction is a group [a.pdf, p. 1]. It is bad.");
    expect(out.stripped).toEqual(["[a.pdf, p. 99]"]);
  });
  it("leaves clean text untouched", () => {
    expect(stripInvalidCitations("Nothing to strip.", sent)).toEqual({ text: "Nothing to strip.", stripped: [] });
  });
});
