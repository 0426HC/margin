import { describe, expect, it } from "vitest";
import { explainedLayerSchema, layerBreakdownSchema, partSplitSchema, pickSourceSchema, reviewSchema } from "@/lib/ai/schemas";

const C = "[f.pdf, p. 1]";

describe("layerBreakdownSchema", () => {
  const layer = { title: "Faction", bigQuestion: "What is a faction?", buildsOn: "", ranges: [{ from: 1, to: 4 }] };
  it("accepts a valid breakdown", () => expect(layerBreakdownSchema.safeParse({ layers: [layer] }).success).toBe(true));
  it.each([
    ["not a question", { ...layer, bigQuestion: "Faction is bad." }],
    ["backwards range", { ...layer, ranges: [{ from: 5, to: 2 }] }],
    ["no ranges", { ...layer, ranges: [] }],
    ["empty title", { ...layer, title: "" }],
  ])("rejects %s", (_n, bad) => expect(layerBreakdownSchema.safeParse({ layers: [bad] }).success).toBe(false));
  it("rejects zero layers and more than 12", () => {
    expect(layerBreakdownSchema.safeParse({ layers: [] }).success).toBe(false);
    expect(layerBreakdownSchema.safeParse({ layers: Array(13).fill(layer) }).success).toBe(false);
  });
});

describe("partSplitSchema and pickSourceSchema", () => {
  it("Part B can't start at unit 1", () => {
    expect(partSplitSchema.safeParse({ firstUnitOfPartB: 1, reason: "x" }).success).toBe(false);
    expect(partSplitSchema.safeParse({ firstUnitOfPartB: 7, reason: "midpoint" }).success).toBe(true);
  });
  it("needs at least one passage number", () => {
    expect(pickSourceSchema.safeParse({ passages: [] }).success).toBe(false);
    expect(pickSourceSchema.safeParse({ passages: [2, 3] }).success).toBe(true);
  });
});

describe("explainedLayerSchema", () => {
  const ok = {
    blocks: [
      { type: "heading", text: "What a faction is" },
      { type: "paragraph", text: `A faction is a group united by a shared impulse. ${C}` },
      { type: "bullets", items: [`Majority factions. ${C}`, `Minority factions. ${C}`] },
      { type: "table", caption: "Two kinds", columns: ["Kind", "Meaning"], rows: [["A", "x"], ["B", "y"]], source: C },
    ],
    soWhat: "This sets up why the Constitution tries to control the effects of faction.",
  };
  it("accepts a cited, well-formed layer", () => expect(explainedLayerSchema.safeParse(ok).success).toBe(true));
  it("rejects an uncited paragraph, bullet or table", () => {
    expect(explainedLayerSchema.safeParse({ ...ok, blocks: [...ok.blocks.slice(0, 1), { type: "paragraph", text: "No cite." }, ...ok.blocks.slice(2)] }).success).toBe(false);
    expect(explainedLayerSchema.safeParse({ ...ok, blocks: [...ok.blocks.slice(0, 2), { type: "bullets", items: ["No cite"] }, ok.blocks[3]] }).success).toBe(false);
    expect(explainedLayerSchema.safeParse({ ...ok, blocks: [...ok.blocks.slice(0, 3), { ...ok.blocks[3], source: "nothing" }] }).success).toBe(false);
  });
  it("rejects a table row with the wrong number of cells", () => {
    const bad = { ...ok, blocks: [...ok.blocks.slice(0, 3), { ...ok.blocks[3], rows: [["only one"]] }] };
    expect(explainedLayerSchema.safeParse(bad).success).toBe(false);
  });
});

describe("reviewSchema", () => {
  const good = { fixes: [{ kind: "name", text: `Madison, not Hamilton. ${C}` }], cleanedUp: "Faction is a group. Madison wrote this.", soWhat: "This is why the framers distrusted pure democracy.", verdict: "needs_work" };
  it("accepts needs_work with fixes", () => expect(reviewSchema.safeParse(good).success).toBe(true));
  it("accepts approved with no fixes, or only grammar notes", () => {
    expect(reviewSchema.safeParse({ ...good, fixes: [], verdict: "approved" }).success).toBe(true);
    expect(reviewSchema.safeParse({ ...good, fixes: [{ kind: "grammar", text: "comma" }], verdict: "approved" }).success).toBe(true);
  });
  it("never approves a write-back that still has a factual, name, term or missing fix", () => {
    for (const kind of ["fact", "name", "term", "missing"]) {
      expect(reviewSchema.safeParse({ ...good, fixes: [{ kind, text: "x" }], verdict: "approved" }).success).toBe(false);
    }
  });
  it("needs_work must list a fix", () => expect(reviewSchema.safeParse({ ...good, fixes: [] }).success).toBe(false));
  it("the so what is exactly one sentence (citation periods don't count)", () => {
    expect(reviewSchema.safeParse({ ...good, soWhat: "One sentence. And a second one here." }).success).toBe(false);
    expect(reviewSchema.safeParse({ ...good, soWhat: `It matters for the argument [fed10.txt, p. 3] as a whole.` }).success).toBe(true);
  });
  it("needs a cleaned-up version", () => expect(reviewSchema.safeParse({ ...good, cleanedUp: "" }).success).toBe(false));
});
