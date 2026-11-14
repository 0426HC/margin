/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, expect, it } from "vitest";
import type { AiRequest } from "@/lib/ai/engine";
import { FakeEngine } from "@/lib/ai/fake-engine";
import { pickLayerSource, proposeLayers, proposePartSplit, reexplainLayer, reviewLayerWriteback, reviewPartSynthesis, sanitizeReview, writeExplained } from "@/lib/ai/tasks";

const passages = [{ file: "f.pdf", page: 1, text: "Alpha." }, { file: "f.pdf", page: 2, text: "Beta." }];
const layer = { title: "T", bigQuestion: "Why?" };
const review = { fixes: [{ kind: "fact", text: "See [f.pdf, p. 2] and [f.pdf, p. 9]." }], cleanedUp: "Alpha [f.pdf, p. 77].", soWhat: "It matters.. here is why.", verdict: "needs_work" };
const goodReview = { ...review, soWhat: "It matters for the whole argument." };
const explained = (cite: string) => ({
  blocks: [{ type: "heading", text: "H" }, { type: "paragraph", text: `Claim ${cite}` }, { type: "bullets", items: [`Point ${cite}`] }],
  soWhat: "This links to the bigger argument overall.",
});

describe("which model each task uses", () => {
  it("layer reviews, synthesis reviews, re-explains, Explained and Source use Opus 5.5 at medium", async () => {
    const fake = new FakeEngine({ json: (r: AiRequest) => (r.system.includes("choose the source") ? { passages: [1] } : r.system.includes("Explained") ? explained("[f.pdf, p. 1]") : { ...goodReview, verdict: "needs_work" }), text: "ok" });
    await reviewLayerWriteback(fake, { layer, passages, writing: "w" });
    await reviewPartSynthesis(fake, { part: "A", layers: [layer], passages, writing: "w" });
    for await (const _ of reexplainLayer(fake, { layer, passages, attempt: 1 }));
    await pickLayerSource(fake, { layer, passages: passages.map((p, i) => ({ ...p, n: i + 1 })) });
    await writeExplained(fake, { layer, passages });
    expect(fake.calls).toHaveLength(5);
    for (const c of fake.calls) expect(c).toMatchObject({ model: "claude-opus-5-5", effort: "medium" });
  });

  it("the Part split and layer breakdown use sonnet with no effort", async () => {
    const fake = new FakeEngine({ json: (r: AiRequest) => (r.prompt.includes("Which unit number") ? { firstUnitOfPartB: 2, reason: "mid" } : { layers: [{ title: "Faction", bigQuestion: "What is a faction?", buildsOn: "", ranges: [{ from: 1, to: 1 }] }] }) });
    await proposePartSplit(fake, [{ n: 1, title: "W1", words: 1 }, { n: 2, title: "W2", words: 1 }]);
    await proposeLayers(fake, { part: "A", passages: [{ n: 1, unit: "W1", ...passages[0] }] });
    for (const c of fake.calls) {
      expect(c.model).toBe("sonnet");
      expect(c.effort).toBeUndefined();
    }
  });
});

describe("citations in AI output never point at nothing", () => {
  it("sanitizeReview strips citations that were not sent, from fixes, cleaned-up text and so-what", () => {
    const { review: r, stripped } = sanitizeReview(goodReview as any, passages);
    expect(r.fixes[0].text).not.toContain("p. 9");
    expect(r.fixes[0].text).toContain("[f.pdf, p. 2]");
    expect(r.cleanedUp).not.toContain("p. 77");
    expect(stripped.sort()).toEqual(["[f.pdf, p. 77]", "[f.pdf, p. 9]"]);
  });

  it("Explained: a bad citation is asked about once, and the second answer is used", async () => {
    let n = 0;
    const fake = new FakeEngine({ json: () => explained(n++ === 0 ? "[f.pdf, p. 50]" : "[f.pdf, p. 2]") });
    const out = await writeExplained(fake, { layer, passages });
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1].prompt).toContain("[f.pdf, p. 50]");
    expect(out.stripped).toEqual([]);
  });

  it("Explained: if the model keeps citing a made-up page it is stripped, never shown", async () => {
    const fake = new FakeEngine({ json: () => explained("[f.pdf, p. 50]") });
    const out = await writeExplained(fake, { layer, passages });
    expect(out.stripped).toEqual(["[f.pdf, p. 50]"]);
    expect(JSON.stringify(out.explained)).not.toContain("p. 50");
  });
});
