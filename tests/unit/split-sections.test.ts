import { describe, expect, it } from "vitest";
import { splitSections } from "@/lib/import/split-sections";
import type { Block, ParsedFile } from "@/lib/import/types";

let seed = 0;
/** n distinct words, so any dropped or reordered text shows up. */
const words = (n: number) => Array.from({ length: n }, () => `w${++seed}`).join(" ");
const p = (n: number, page = 1): Block => ({ kind: "paragraph", text: words(n), page });
const h = (text: string, level: number, page = 1): Block => ({ kind: "heading", text, level, page });
const file = (blocks: Block[], pageKind: ParsedFile["pageKind"] = "page"): ParsedFile => ({
  kind: "pdf",
  pageKind,
  pageCount: Math.max(...blocks.map((b) => b.page)),
  blocks,
  runningHeaders: [],
});
const texts = (bs: Block[]) => bs.map((b) => b.text);
const count = (s: { wordCount: number }) => s.wordCount;

/** The key guarantee: nothing dropped, added, reordered or reworded. */
function expectVerbatim(f: ParsedFile) {
  const sections = splitSections(f);
  expect(texts(sections.flatMap((s) => s.blocks))).toEqual(texts(f.blocks));
  expect(sections.flatMap((s) => s.blocks.map((b) => b.page))).toEqual(f.blocks.map((b) => b.page));
  return sections;
}

describe("splitSections: headings", () => {
  it("cuts at headings and titles each section from its heading", () => {
    const f = file([h("Faction", 1), p(1500), h("Remedies", 1, 2), p(1500, 2), h("Republics", 1, 3), p(1500, 3)]);
    const s = expectVerbatim(f);
    expect(s.map((x) => x.title)).toEqual(["Faction", "Remedies", "Republics"]);
    expect(s.map((x) => [x.pageStart, x.pageEnd])).toEqual([[1, 1], [2, 2], [3, 3]]);
  });

  it("treats one leading H1 as the document title and cuts at the H2s", () => {
    const f = file([h("The Reader", 1), h("One", 2), p(1400), h("Two", 2), p(1400)]);
    const s = expectVerbatim(f);
    expect(s.map((x) => x.title)).toEqual(["One", "Two"]);
  });

  it("goes down to sub-headings when a part is too long", () => {
    const f = file([h("Chapter", 1), p(100), h("Alpha", 2), p(1500), h("Beta", 2), p(1500), h("Gamma", 2), p(1500)]);
    const s = expectVerbatim(f);
    expect(s.map((x) => x.title)).toEqual(["Chapter", "Beta", "Gamma"]);
    expect(s.every((x) => x.wordCount <= 2300)).toBe(true);
    expect(s.length).toBeGreaterThanOrEqual(3);
  });

  it("splits a long part at paragraph boundaries, never inside a paragraph", () => {
    const f = file([h("Long", 1), ...Array.from({ length: 10 }, () => p(500))]);
    const s = expectVerbatim(f);
    expect(s).toHaveLength(3);
    expect(s.map((x) => x.title)).toEqual(["Long (part 1 of 3)", "Long (part 2 of 3)", "Long (part 3 of 3)"]);
    expect(s.every((x) => x.wordCount <= 2300)).toBe(true);
  });

  it("keeps a heading with the paragraph that follows it when cutting a long part", () => {
    const f = file([h("Long", 1), p(1200), p(1200), h("Aside", 3), p(1200)]);
    const s = expectVerbatim(f);
    for (const x of s) expect(x.blocks[x.blocks.length - 1].kind).not.toBe("heading");
  });

  it("merges a tiny neighbour into the shorter side", () => {
    const f = file([h("Alpha", 1), p(1500), h("Beta", 1, 2), p(100, 2), h("Gamma", 1, 3), p(1500, 3)]);
    const s = expectVerbatim(f);
    expect(s).toHaveLength(2);
    expect(s[0].title).toBe("Alpha");
    expect(count(s[0])).toBeGreaterThan(1600);
  });

  it("titles a small file that merges down to one section with its document title", () => {
    const f = file([h("Notes on Federalist No. 10", 1), h("Worry", 2), p(150), h("Two ways", 2), p(120), h("Why it helps", 2), p(100)]);
    const s = expectVerbatim(f);
    expect(s).toHaveLength(1);
    expect(s[0].title).toBe("Notes on Federalist No. 10");
  });

  it("leaves a small file as one section", () => {
    const s = expectVerbatim(file([h("Short", 1), p(200)]));
    expect(s).toHaveLength(1);
    expect(s[0].title).toBe("Short");
  });
});

describe("splitSections: numbered or named parts", () => {
  const fed = (n: number, sub: string, page: number): Block[] => [
    { kind: "paragraph", text: `FEDERALIST No. ${n}`, page },
    { kind: "paragraph", text: sub, page },
    { kind: "paragraph", text: "MADISON", page },
    p(1500, page),
  ];

  it("cuts at 'Federalist No. N' lines and titles with the subtitle", () => {
    const f = file([...fed(9, "The Union as a Safeguard", 1), ...fed(10, "The Same Subject Continued", 2)], "virtual");
    const s = expectVerbatim(f);
    expect(s.map((x) => x.title)).toEqual(["FEDERALIST No. 9: The Union as a Safeguard", "FEDERALIST No. 10: The Same Subject Continued"]);
  });

  it("does not cut on a single numbered line, and uses a leading one as the title", () => {
    const f = file([{ kind: "paragraph", text: "Part II", page: 1 }, p(1500)]);
    const s = expectVerbatim(f);
    expect(s).toHaveLength(1);
    expect(s[0].title).toBe("Part II");
  });

  it("ignores a single numbered line that is not at the start", () => {
    const f = file([p(800), { kind: "paragraph", text: "Part II", page: 1 }, p(800)]);
    const s = expectVerbatim(f);
    expect(s.map((x) => x.title)).toEqual(["Page 1"]);
  });

  it("ignores long paragraphs that merely start with a number", () => {
    const f = file([p(1500), { kind: "paragraph", text: `1. ${words(60)}`, page: 1 }, { kind: "paragraph", text: `2. ${words(60)}`, page: 1 }]);
    expect(expectVerbatim(f)).toHaveLength(1);
  });
});

describe("splitSections: slides", () => {
  const slide = (n: number): Block[] => [h(`Slide title ${n}`, 1, n), { kind: "list", text: `- ${words(30)}`, page: n }];

  it("groups slides into one section when they fit, and never splits a slide", () => {
    const f = file(Array.from({ length: 12 }, (_, i) => slide(i + 1)).flat(), "slide");
    const s = expectVerbatim(f);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ title: "Slide title 1", pageStart: 1, pageEnd: 12 });
  });

  it("splits a long deck on slide boundaries into balanced groups", () => {
    const f = file(Array.from({ length: 30 }, (_, i) => slide(i + 1)).flat(), "slide");
    const s = expectVerbatim(f);
    expect(s).toHaveLength(2);
    expect(s[0].pageEnd + 1).toBe(s[1].pageStart);
    const seen = s.flatMap((x) => [...new Set(x.blocks.map((b) => b.page))]);
    expect(new Set(seen).size).toBe(seen.length); // each slide is in exactly one section
  });

  it("falls back to 'Slides a–b' when the first slide has no title", () => {
    const f = file([{ kind: "paragraph", text: words(400), page: 1 }, { kind: "paragraph", text: words(400), page: 2 }], "slide");
    expect(expectVerbatim(f)[0].title).toBe("Slides 1–2");
  });
});

describe("splitSections: page ranges", () => {
  it("cuts a PDF with no structure at page boundaries", () => {
    const f = file(Array.from({ length: 10 }, (_, i) => p(500, i + 1)));
    const s = expectVerbatim(f);
    expect(s).toHaveLength(3);
    expect(s.map((x) => x.title)).toEqual(s.map((x) => `Pages ${x.pageStart}–${x.pageEnd}`));
    expect(s.every((x) => x.wordCount <= 2300)).toBe(true);
    for (let i = 1; i < s.length; i++) expect(s[i].pageStart).toBe(s[i - 1].pageEnd + 1);
  });

  it("titles a single page 'Page 3'", () => {
    expect(expectVerbatim(file([p(300, 3)]))[0].title).toBe("Page 3");
  });

  it("returns no sections for an empty file", () => {
    expect(splitSections({ kind: "txt", pageKind: "virtual", pageCount: 0, blocks: [], runningHeaders: [] })).toEqual([]);
  });
});

describe("splitSections: titles that are not junk", () => {
  const titleOk = (t: string) => expect(/^(Pages? \d+(–\d+)?|.+ \(pp?\. \d+(–\d+)?\)|.+)$/.test(t) && !/^.{0,2}$/.test(t)).toBe(true);

  it("never uses a junk line as a title: falls back to the nearest real heading and the pages", () => {
    const f = file([h("Real One", 1), p(1500), h("@ The Mainsprings of Action", 1, 2), p(1500, 2)]);
    const s = expectVerbatim(f);
    expect(s.map((x) => x.title)).toEqual(["Real One", "Real One (p. 2)"]);
  });

  it("uses a page range when there is no real heading before it", () => {
    const f = file([h("J", 1), p(1500), h("Real Two", 1, 2), p(1500, 2)]);
    const s = expectVerbatim(f);
    expect(s.map((x) => x.title)).toEqual(["Page 1", "Real Two"]);
  });

  it("folds a drop-cap 'heading' into its neighbour instead of making a section", () => {
    const f = file([h("Real One", 1), p(1500), h("J", 1, 2), p(80, 2)]);
    const s = expectVerbatim(f);
    expect(s.map((x) => x.title)).toEqual(["Real One"]);
  });

  it("uses the pages of the piece when a junk-titled part is split", () => {
    const f = file([h("Real One", 1), p(900), h("r", 1, 2), ...Array.from({ length: 6 }, (_, i) => p(500, 2 + i))]);
    const s = expectVerbatim(f);
    for (const x of s) titleOk(x.title);
    expect(s.some((x) => /^Real One \(pp?\. /.test(x.title))).toBe(true);
    expect(s.every((x) => x.title.length > 2)).toBe(true);
  });

  it("drops a junk subtitle from a 'Federalist No. N' title", () => {
    const named = (n: number, sub: string, page: number): Block[] => [
      { kind: "paragraph", text: `FEDERALIST No. ${n}`, page },
      { kind: "paragraph", text: sub, page },
      p(1500, page),
    ];
    const s = expectVerbatim(file([...named(9, "~ j r", 1), ...named(10, "The Same Subject Continued", 2)], "virtual"));
    expect(s.map((x) => x.title)).toEqual(["FEDERALIST No. 9", "FEDERALIST No. 10: The Same Subject Continued"]);
  });
});

describe("splitSections: long readings use their own headings first", () => {
  it("cuts a long part at title-like lines inside it before falling back to part numbers", () => {
    const f = file([h("Reading", 1), p(900), p(900), { kind: "paragraph", text: "The Rise of Faction", page: 2 }, p(900, 2), { kind: "paragraph", text: "REMEDIES AND LIMITS", page: 3 }, p(900, 3)]);
    const s = expectVerbatim(f);
    expect(s.map((x) => x.title)).toEqual(["Reading", "The Rise of Faction", "REMEDIES AND LIMITS"]);
  });

  it("does not take ordinary short sentences for headings", () => {
    const f = file([h("Long", 1), ...Array.from({ length: 5 }, () => p(600)), { kind: "paragraph", text: "He said no.", page: 1 }, p(600)]);
    const s = expectVerbatim(f);
    expect(s.every((x) => /^Long \(part \d of \d\)$/.test(x.title))).toBe(true);
  });

  it("falls back to part numbers only when there are no headings at all", () => {
    const s = expectVerbatim(file([h("Long", 1), ...Array.from({ length: 10 }, () => p(500))]));
    expect(s.map((x) => x.title)).toEqual(["Long (part 1 of 3)", "Long (part 2 of 3)", "Long (part 3 of 3)"]);
  });

  it("cuts at the reading's own sub-headings even when they share the part's level", () => {
    const f = file([h("Reading", 2), p(700), h("Method", 3), p(900, 2), h("Results", 3), p(900, 3), h("Discussion", 3), p(900, 4)]);
    const s = expectVerbatim(f);
    expect(s.map((x) => x.title)).toEqual(["Reading", "Method", "Results", "Discussion"].filter((_, i) => i < s.length));
    expect(s.every((x) => !/part \d/.test(x.title))).toBe(true);
  });
});
