// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseFile, ImportError } from "@/lib/import/parse";
import { makeDocx, makePdf, makePptx } from "../fixtures/build";

const enc = (s: string) => new TextEncoder().encode(s);
const w = (s: string) => s.split(/\s+/).filter(Boolean);
const wordsOf = (blocks: { text: string }[]) => w(blocks.map((b) => b.text).join(" "));

describe("text and markdown", () => {
  it("rebuilds paragraphs from a hard-wrapped .txt and keeps every word", async () => {
    const src = "FEDERALIST No. 1\n\nAFTER an unequivocal experience of the inef-\nficacy of the subsisting\nfederal government.\n\nSecond paragraph\nhere.\n";
    const f = await parseFile("fed.txt", enc(src));
    expect(f).toMatchObject({ kind: "txt", pageKind: "virtual" });
    expect(f.blocks.map((b) => b.text)).toEqual([
      "FEDERALIST No. 1",
      "AFTER an unequivocal experience of the inefficacy of the subsisting federal government.",
      "Second paragraph here.",
    ]);
  });

  it("reads markdown headings and lists, and keeps every word", async () => {
    const src = "# Title\n\nIntro text.\n\n## Part one\n\n- alpha\n- beta\n\nTail.\n";
    const f = await parseFile("n.md", enc(src));
    expect(f.blocks.map((b) => [b.kind, b.level, b.text])).toEqual([
      ["heading", 1, "Title"],
      ["paragraph", undefined, "Intro text."],
      ["heading", 2, "Part one"],
      ["list", undefined, "- alpha\n- beta"],
      ["paragraph", undefined, "Tail."],
    ]);
    expect(wordsOf(f.blocks)).toEqual(w("Title Intro text. Part one - alpha - beta Tail."));
  });

  it("numbers virtual pages of about 400 words", async () => {
    const para = (i: number) => Array.from({ length: 100 }, (_, k) => `p${i}w${k}`).join(" ");
    const src = Array.from({ length: 10 }, (_, i) => para(i)).join("\n\n");
    const f = await parseFile("long.txt", enc(src));
    expect(f.blocks.map((b) => b.page)).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 3, 3]);
    expect(f.pageCount).toBe(3);
  });
});

describe("docx", () => {
  it("keeps heading levels, paragraphs and lists", async () => {
    const bytes = await makeDocx([
      { text: "Notes on faction", heading: 1 },
      { text: "A faction is a number of citizens.", },
      { text: "Causes", heading: 2 },
      { text: "first cause", bullet: true },
      { text: "second cause", bullet: true },
    ]);
    const f = await parseFile("notes.docx", bytes);
    expect(f).toMatchObject({ kind: "docx", pageKind: "virtual" });
    expect(f.blocks.map((b) => [b.kind, b.level, b.text])).toEqual([
      ["heading", 1, "Notes on faction"],
      ["paragraph", undefined, "A faction is a number of citizens."],
      ["heading", 2, "Causes"],
      ["list", undefined, "first cause\nsecond cause"],
    ]);
  });

  it("decodes entities", async () => {
    const f = await parseFile("a.docx", await makeDocx([{ text: "Checks & balances <1787>" }]));
    expect(f.blocks[0].text).toBe("Checks & balances <1787>");
  });
});

describe("pptx", () => {
  it("numbers slides, makes titles headings and bullets lists", async () => {
    const bytes = await makePptx([
      { title: "Separation of powers", bullets: ["Legislative", "Executive"] },
      { title: "Checks", bullets: ["Veto"] },
      { bullets: ["Untitled slide text"] },
      { title: "Last" },
    ]);
    const f = await parseFile("lecture.pptx", bytes);
    expect(f).toMatchObject({ kind: "pptx", pageKind: "slide", pageCount: 4 });
    expect(f.blocks.map((b) => [b.page, b.kind, b.text])).toEqual([
      [1, "heading", "Separation of powers"],
      [1, "list", "Legislative\nExecutive"],
      [2, "heading", "Checks"],
      [2, "list", "Veto"],
      [3, "list", "Untitled slide text"],
      [4, "heading", "Last"],
    ]);
  });

  it("follows the presentation's slide order, not the file names", async () => {
    const bytes = await makePptx([{ title: "First" }, { title: "Second" }, { title: "Third" }], [2, 0, 1]);
    const f = await parseFile("x.pptx", bytes);
    expect(f.blocks.map((b) => [b.page, b.text])).toEqual([[1, "First"], [2, "Second"], [3, "Third"]]);
  });
});

describe("pdf", () => {
  const header = { text: "POL101 Course Reader", size: 9 };
  const pageOf = (n: number, body: { text: string; gap?: number }[], extra: { text: string; size?: number; gap?: number }[] = []) => [
    header,
    ...extra,
    ...body,
    { text: String(n), size: 9, gap: 520 },
  ];

  const bytes = makePdf([
    pageOf(1, [{ text: "AMONG the numerous advantages promised by a well", gap: 14 }, { text: "constructed Union, none deserves to be more accu-" }, { text: "rately developed than its tendency." }, { text: "A second paragraph begins here.", gap: 14 }], [{ text: "On Faction", size: 24, gap: 6 }]),
    pageOf(2, [{ text: "Page two body text sits here.", gap: 10 }]),
    pageOf(3, [{ text: "Page three body text sits here.", gap: 10 }]),
  ]);

  it("keeps page numbers, makes the large line a heading, and lifts the running header and page numbers", async () => {
    const f = await parseFile("reader.pdf", bytes);
    expect(f).toMatchObject({ kind: "pdf", pageKind: "page", pageCount: 3, runningHeaders: ["POL101 Course Reader"] });
    expect(f.blocks.map((b) => [b.page, b.kind, b.text])).toEqual([
      [1, "heading", "On Faction"],
      [1, "paragraph", "AMONG the numerous advantages promised by a well constructed Union, none deserves to be more accurately developed than its tendency."],
      [1, "paragraph", "A second paragraph begins here."],
      [2, "paragraph", "Page two body text sits here."],
      [3, "paragraph", "Page three body text sits here."],
    ]);
  });

  it("says plainly when a PDF cannot be read", async () => {
    await expect(parseFile("bad.pdf", enc("this is not a pdf"))).rejects.toThrow(ImportError);
    await expect(parseFile("bad.pdf", enc("this is not a pdf"))).rejects.toThrow(/can't be read/);
  });

  it("says plainly when a PDF has no text layer", async () => {
    await expect(parseFile("scan.pdf", makePdf([[{ text: "" }], [{ text: "" }]]))).rejects.toThrow(/no text|scanned/i);
  });
});

describe("parseFile", () => {
  it("rejects types it does not read", async () => {
    await expect(parseFile("a.xlsx", enc("x"))).rejects.toThrow(/isn't a type Margin reads/);
  });
  it("rejects an empty text file", async () => {
    await expect(parseFile("empty.txt", enc("  \n "))).rejects.toThrow(/empty/i);
  });
});
