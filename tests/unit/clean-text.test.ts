import { describe, expect, it } from "vitest";
import { cleanPages } from "@/lib/import/clean-text";
import type { RawLine, RawPage } from "@/lib/import/types";

const page = (n: number, ...lines: (string | RawLine)[]): RawPage => ({
  page: n,
  lines: lines.map((l) => (typeof l === "string" ? { text: l } : l)),
});
const words = (s: string) => s.split(/\s+/).filter(Boolean);

describe("cleanPages", () => {
  it("rejoins a word hyphenated across a line break", () => {
    const { blocks } = cleanPages([page(1, "The govern-", "ment of the people.")]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("The government of the people.");
  });

  it("leaves a hyphen alone when the next line does not start in lowercase", () => {
    const { blocks } = cleanPages([page(1, "the Anglo-", "Saxon tradition")]);
    expect(blocks[0].text).toBe("the Anglo- Saxon tradition");
  });

  it("rebuilds paragraphs from hard-wrapped lines and splits on blank lines", () => {
    const { blocks } = cleanPages([page(1, "first line of", "one paragraph.", "", "second paragraph", "here.")]);
    expect(blocks.map((b) => b.text)).toEqual(["first line of one paragraph.", "second paragraph here."]);
    expect(blocks.every((b) => b.kind === "paragraph")).toBe(true);
  });

  it("splits an unbroken page where a short sentence-ending line is followed by a capital", () => {
    const long = "This is a long line of body text that runs nearly to the right edge of the column";
    const { blocks } = cleanPages([page(1, long, "and then finishes the sentence here.", "A new paragraph starts here and goes on", "for a little while.")]);
    expect(blocks.map((b) => b.text)).toEqual([
      `${long} and then finishes the sentence here.`,
      "A new paragraph starts here and goes on for a little while.",
    ]);
  });

  it("lifts bare page numbers and repeated running headers out of the text", () => {
    const pages = [1, 2, 3].map((n) => page(n, "POL101 Course Reader", `Body text number ${n} sits here.`, String(n)));
    const { blocks, runningHeaders } = cleanPages(pages);
    expect(blocks.map((b) => b.text)).toEqual(["Body text number 1 sits here.", "Body text number 2 sits here.", "Body text number 3 sits here."]);
    expect(runningHeaders).toEqual(["POL101 Course Reader"]);
  });

  it("recognises 'Page 3 of 10' as a page number but keeps a number that is part of a sentence", () => {
    const { blocks } = cleanPages([page(1, "Page 1 of 10", "In 1787 delegates met.", "42")]);
    expect(blocks.map((b) => b.text)).toEqual(["In 1787 delegates met."]);
    const kept = cleanPages([page(1, "Intro.", "", "It was 1787", "", "Body.", "", "End.")]);
    expect(kept.blocks.map((b) => b.text)).toContain("It was 1787");
  });

  it("does not lift a line that merely repeats once", () => {
    const pages = [page(1, "Introduction", "", "Body one.", "More.", "Last."), page(2, "Body two."), page(3, "Body three.")];
    expect(cleanPages(pages).blocks.map((b) => b.text)).toContain("Introduction");
  });

  it("keeps list markers and groups consecutive items into one list block", () => {
    const { blocks } = cleanPages([page(1, "Bring:", "", "- a pencil", "- a long", "  ruler", "2. an eraser", "", "Done.")]);
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "list", "paragraph"]);
    expect(blocks[1].text).toBe("- a pencil\n- a long ruler\n2. an eraser");
  });

  it("makes heading blocks, merging a heading that wraps onto two lines", () => {
    const { blocks } = cleanPages([
      page(1, { text: "The Union as a Safeguard", heading: 1 }, { text: "Against Faction", heading: 1 }, "", "Body."),
    ]);
    expect(blocks[0]).toMatchObject({ kind: "heading", level: 1, text: "The Union as a Safeguard Against Faction", page: 1 });
    expect(blocks[1].kind).toBe("paragraph");
  });

  it("keeps the page number on every block", () => {
    const { blocks } = cleanPages([page(4, "Alpha beta.", "", "Gamma."), page(5, "Delta.")]);
    expect(blocks.map((b) => b.page)).toEqual([4, 4, 5]);
  });

  it("never changes a word: output words equal input words minus the lifted lines", () => {
    const input = [
      page(1, "Header X", "The quick brown fox jumps over the la-", "zy dog and keeps running", "", "Second para.", "1"),
      page(2, "Header X", "More text on page two.", "2"),
      page(3, "Header X", "Final words here.", "3"),
    ];
    const out = cleanPages(input).blocks.map((b) => b.text).join(" ");
    expect(words(out)).toEqual(words("The quick brown fox jumps over the lazy dog and keeps running Second para. More text on page two. Final words here."));
  });
});
