import { describe, expect, it } from "vitest";
import { explainLayer, layerBreakdown, partSplit, pickSource, reexplain, reviewSynthesis, reviewWriteback } from "@/lib/ai/prompts";

const passages = [
  { file: "fed10.txt", page: 3, text: "A faction is a number of citizens united by a common impulse." },
  { file: "fed10.txt", page: 4, text: "The causes of faction cannot be removed." },
];
const layer = { title: "What is a faction?", bigQuestion: "Why does Madison fear faction?" };

describe("explainLayer", () => {
  const p = explainLayer({ layer, passages, previous: { title: "Prev", bigQuestion: "Q1?" }, next: { title: "Next", bigQuestion: "Q2?" } });
  it("carries every style rule from the brief", () => {
    for (const rule of [
      /basics underneath the concept, before course terms/i,
      /Explain every name, author, case or term the first time/i,
      /Never drop an unexplained name/i,
      /concrete examples/i,
      /analogy only if/i,
      /table for any typology/i,
      /No story or narrative/i,
      /so what/i,
      /\[file, p\. N\]/,
      /Use ONLY the course passages/i,
    ]) expect(p.system).toMatch(rule);
  });
  it("includes the passages with their citations, the layer, and its neighbours", () => {
    expect(p.prompt).toContain("[fed10.txt, p. 3]\nA faction is a number");
    expect(p.prompt).toContain("Why does Madison fear faction?");
    expect(p.prompt).toContain("Previous layer: Prev");
    expect(p.prompt).toContain("Next layer: Next");
  });
});

describe("reviewWriteback", () => {
  const p = reviewWriteback({ layer, passages, writing: "Faction is when people group up." });
  it("tells the reviewer to keep the student's wording and never invent facts", () => {
    expect(p.system).toMatch(/Keep their wording/);
    expect(p.system).toMatch(/Never invent names, dates, numbers, quotes or page numbers/);
    expect(p.system).toMatch(/fixes/);
    expect(p.system).toMatch(/cleanedUp/);
    expect(p.system).toMatch(/exactly one sentence/);
    expect(p.system).toMatch(/"approved" only if/);
  });
  it("sends the student's writing and the passages", () => {
    expect(p.prompt).toContain("Faction is when people group up.");
    expect(p.prompt).toContain("[fed10.txt, p. 4]");
  });
  it("on a resubmission includes the earlier attempt and the fixes that were asked for", () => {
    const again = reviewWriteback({ layer, passages, writing: "v2", previousWriting: "v1 text", previousFixes: ["name Madison"] });
    expect(again.prompt).toContain("v1 text");
    expect(again.prompt).toContain("- name Madison");
  });
});

describe("reviewSynthesis", () => {
  it("lists each layer with what the student saved, and flags unsaved layers", () => {
    const p = reviewSynthesis({ part: "A", layers: [{ ...layer, final: "My layer one." }, { title: "L2", bigQuestion: "Q?" }], passages, writing: "All together." });
    expect(p.prompt).toContain("My layer one.");
    expect(p.prompt).toContain("has not saved this layer yet");
    expect(p.system).toMatch(/pulls the layers together/);
  });
});

describe("reexplain", () => {
  it("asks for a simpler, more basic explanation and another try; goes more basic on later attempts", () => {
    const p = reexplain({ layer, passages, attempt: 2, confusion: "what is a faction" });
    expect(p.system).toMatch(/more simply and from a more basic level/);
    expect(p.system).toMatch(/attempt 2/);
    expect(p.system).toMatch(/try writing the layer back again/);
    expect(p.prompt).toContain("what is a faction");
  });
});

describe("pickSource, partSplit, layerBreakdown", () => {
  it("pickSource shows numbered passages and forbids touching the text", () => {
    const p = pickSource({ layer, passages: passages.map((x, i) => ({ ...x, n: i + 1 })) });
    expect(p.prompt).toContain("#2 [fed10.txt, p. 4]");
    expect(p.system).toMatch(/Never alter or quote the text/);
  });
  it("partSplit lists units in order and asks for Part B's first unit", () => {
    const p = partSplit([{ n: 1, title: "Week 1", words: 4000 }, { n: 2, title: "Week 2", words: 5000 }]);
    expect(p.prompt).toContain("2. Week 2 (5000 words)");
    expect(p.prompt).toMatch(/Part B start/);
  });
  it("layerBreakdown states the topic rules and the coverage rule", () => {
    const p = layerBreakdown({ part: "B", passages: [{ n: 1, unit: "Week 7", file: "f.pdf", page: 1, text: "word ".repeat(60) }] });
    expect(p.system).toMatch(/4 to 8 layers/);
    expect(p.system).toMatch(/Do not split strictly by week/);
    expect(p.system).toMatch(/every passage exactly once/);
    expect(p.prompt).toContain("#1 | Week 7 | f.pdf p. 1 |");
    expect(p.prompt.split("…")[0].split(" | ")[3].split(" ").length).toBeLessThanOrEqual(28);
  });
});
