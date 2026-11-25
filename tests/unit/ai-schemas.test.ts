import { describe, expect, it } from "vitest";
import { explainedSchema, layerBreakdownSchema, pickSourceSchema, reviewSchema } from "@/lib/ai/schemas";

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

describe("pickSourceSchema", () => {
  it("needs at least one passage number", () => {
    expect(pickSourceSchema.safeParse({ passages: [] }).success).toBe(false);
    expect(pickSourceSchema.safeParse({ passages: [2, 3] }).success).toBe(true);
  });
});

describe("explainedSchema", () => {
  const ok = {
    summary: "A faction is a group held together by a shared passion. Madison fears them because they can capture government. The cure he proposes is a large republic.",
    sections: [
      { question: "What is a faction?", blocks: [{ type: "paragraph", text: `A faction is a group united by a shared impulse. ${C}` }, { type: "bullets", items: ["Majority factions can outvote everyone.", `Minority factions can be outvoted. ${C}`] }] },
      { question: "Why can't its causes be removed?", blocks: [{ type: "table", caption: "Two cures", columns: ["Cure", "Why it fails"], rows: [["Remove liberty", "Worse than the disease."], ["Same opinions", "Impossible."]], source: C }] },
    ],
    concepts: [{ name: "Faction", meaning: "A group united against others' rights.", example: `Madison's opening definition. ${C}`, why: "It is what the essay is about." }],
    soWhat: "This sets up why the Constitution tries to control the effects of faction.",
  };
  it("accepts summary, sections answering sub-questions, Key concepts and a so what", () => expect(explainedSchema.safeParse(ok).success).toBe(true));
  it("lets a sentence of analysis go without a citation (code checks each section rests on cited material)", () => {
    expect(explainedSchema.safeParse({ ...ok, sections: [{ ...ok.sections[0], blocks: [{ type: "paragraph", text: "This is why it matters." }] }, ok.sections[1]] }).success).toBe(true);
  });
  it("needs a summary, at least two sections, and rows of one cell per column", () => {
    const { summary: _s, ...without } = ok;
    void _s;
    expect(explainedSchema.safeParse(without).success).toBe(false);
    expect(explainedSchema.safeParse({ ...ok, sections: [ok.sections[0]] }).success).toBe(false);
    expect(explainedSchema.safeParse({ ...ok, sections: [ok.sections[0], { question: "Why?", blocks: [{ type: "table", caption: "x", columns: ["a", "b"], rows: [["one"]], source: C }] }] }).success).toBe(false);
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
