import { describe, expect, it } from "vitest";
import { isLowQuality, isRealHeading, pdfTextQuality, textQuality } from "@/lib/import/text-quality";

describe("isRealHeading", () => {
  it.each([
    "Introduction",
    "Preface",
    "FEDERALIST No. 10",
    "The Mainsprings of Action",
    "Chapter 3: Faction and the Republic",
    "1. Introduction",
    "IV. The Remedy",
    "What is a faction?",
    "Slide title 12",
  ])("accepts %j", (t) => expect(isRealHeading(t)).toBe(true));

  it.each([
    ["a drop cap", "J"],
    ["a stray letter", "r"],
    ["a leading symbol", "@ The Mainsprings of Action"],
    ["a number alone", "12"],
    ["a fragment starting mid-sentence", "of the people and"],
    ["a fragment ending on a comma", "Introduction,"],
    ["digits inside words", "Th3 M@insprlngs of Acti0n"],
    ["scattered single letters", "a b c d e"],
    ["only symbols", "~ ' | j r"],
    ["a whole paragraph", "word ".repeat(60)],
    ["nothing", "   "],
  ])("rejects %s", (_n, t) => expect(isRealHeading(t)).toBe(false));
});

describe("textQuality", () => {
  const clean = "Among the numerous advantages promised by a well constructed Union, none deserves to be more accurately developed than its tendency to break and control the violence of faction.";
  const junk = "Tbe rnain @ spr1ngs ~ of acti0n | ar3 j r ' wlth brok3n w0rds f# &x r! Tr1e |_ ^ ( 7 fnll 0f n0ise";

  it("scores clean prose near 1", () => expect(textQuality(clean)).toBeGreaterThan(0.95));
  it("scores noisy OCR text low", () => expect(textQuality(junk)).toBeLessThan(0.7));
  it("keeps normal numbers, names and punctuation", () => expect(textQuality("In 1787, Madison (of Virginia) wrote No. 10 — on faction; see pp. 3-4.")).toBeGreaterThan(0.95));
  it("scores no text as 0", () => expect(textQuality("")).toBe(0));
});

describe("pdfTextQuality and isLowQuality", () => {
  const page = "Among the numerous advantages promised by a well constructed Union ".repeat(6);
  it("is not low for a dense, clean PDF", () => expect(isLowQuality(pdfTextQuality(page.repeat(3), 3))).toBe(false));
  it("is low for noisy text", () => expect(isLowQuality(pdfTextQuality("Tbe rnain @ spr1ngs ~ of acti0n | ar3 j r ' ".repeat(30), 1))).toBe(true));
  it("is low when the pages hold almost no text, which usually means a scan", () => {
    expect(isLowQuality(pdfTextQuality("Page header only for this scanned book ".repeat(2), 20))).toBe(true);
  });
});
