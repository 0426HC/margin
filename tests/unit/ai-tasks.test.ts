/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, expect, it } from "vitest";
import type { AiRequest } from "@/lib/ai/engine";
import { FakeEngine } from "@/lib/ai/fake-engine";
import type { LayerNote } from "@/lib/layers/explained-check";
import { pickLayerSource, proposeWeekLayers, reexplainLayer, reviewLayerWriteback, reviewWeekSynthesis, sanitizeReview, writeExplained } from "@/lib/ai/tasks";

const passages = [{ file: "f.pdf", page: 1, text: "Alpha." }, { file: "f.pdf", page: 2, text: "Beta." }];
const layer = { title: "T", bigQuestion: "Why?" };
const review = { fixes: [{ kind: "fact", text: "See [f.pdf, p. 2] and [f.pdf, p. 9]." }], cleanedUp: "Alpha [f.pdf, p. 77].", soWhat: "It matters.. here is why.", verdict: "needs_work" };
const goodReview = { ...review, soWhat: "It matters for the whole argument." };
/** Explained as Claude streams it: a summary, two sections (the second ends with a citation alone on its line), the so what. */
const explainedText = (cite: string, cite2 = cite, extra = "") => `# Summary
This layer explains one idea in plain words. It starts from the basics. It ends with why the idea matters.

## What is the first step?
Claim ${cite}

- An analysis that needs no citation.
- Point ${cite}
${extra}
## Why does it matter?
Because of this. ${cite2}

${cite2}

# So what
This links to the bigger argument overall.`;
const input = (notes: LayerNote[] = []) => ({ course: "C", week: { label: "Week 1", syllabus: null }, layer, passages, notes, length: { target: 80, max: 1000, min: 10 } });

describe("which model each task uses", () => {
  it("layer reviews, synthesis reviews and re-explains use Opus 5.5 at medium; Explained and Source Opus 5.5 at low, for speed", async () => {
    const fake = new FakeEngine({ json: (r: AiRequest) => (r.system.includes("choose the source") ? { passages: [1] } : { ...goodReview, verdict: "needs_work" }), text: (r: AiRequest) => (r.system.includes("Explained") ? explainedText("[f.pdf, p. 1]") : "ok") });
    await reviewLayerWriteback(fake, { layer, passages, writing: "w" });
    await reviewWeekSynthesis(fake, { week: "Week 1", layers: [layer], passages, writing: "w" });
    for await (const _ of reexplainLayer(fake, { layer, passages, attempt: 1 }));
    await pickLayerSource(fake, { layer, passages: passages.map((p, i) => ({ ...p, n: i + 1 })) });
    await writeExplained(fake, input());
    expect(fake.calls).toHaveLength(5);
    for (const c of fake.calls.slice(0, 3)) expect(c).toMatchObject({ model: "claude-opus-5-5", effort: "medium" });
    for (const c of fake.calls.slice(3)) expect(c).toMatchObject({ model: "claude-opus-5-5", effort: "low" });
  });

  it("the course plan (each week's layers) uses Opus 5.5 at medium effort", async () => {
    const fake = new FakeEngine({ json: { layers: [{ title: "Faction", bigQuestion: "What is a faction?", buildsOn: "", ranges: [{ from: 1, to: 1 }] }] } });
    await proposeWeekLayers(fake, { course: "POL101", week: "Week 1 · Foundations", minLayers: 1, passages: [{ n: 1, file: passages[0].file, page: passages[0].page, role: "Reading", section: "Intro", words: 60, text: passages[0].text }] });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ model: "claude-opus-5-5", effort: "medium" });
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

  it("Explained streams: the text so far is passed on as it is written, and read into its parts at the end", async () => {
    const seen: string[] = [];
    const out = await writeExplained(new FakeEngine({ text: explainedText("[f.pdf, p. 1]") }), input(), { onText: (t) => seen.push(t) });
    expect(seen.length).toBeGreaterThan(10);
    expect(seen[seen.length - 1]).toContain("# So what");
    expect(out.explained.sections.map((s) => s.question)).toEqual(["What is the first step?", "Why does it matter?"]);
    expect(out.explained.soWhat).toBe("This links to the bigger argument overall.");
  });

  it("Explained: a section with a bad citation is written again on its own; the other section is never sent back", async () => {
    const fake = new FakeEngine({ text: (r: AiRequest) => (r.system.includes("You fix one section") ? "## Why does it matter?\n\nBecause of this, said again. [f.pdf, p. 2]" : explainedText("[f.pdf, p. 1]", "[f.pdf, p. 50]")) });
    const out = await writeExplained(fake, input());
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1].prompt).toMatch(/## The section to write again\n## Why does it matter\?/);
    expect(fake.calls[1].prompt).toContain("[f.pdf, p. 50]");
    expect(out.explained.sections[0].blocks[0]).toEqual({ type: "paragraph", text: "Claim [f.pdf, p. 1]" });
    expect(out.explained.sections[1].blocks).toEqual([{ type: "paragraph", text: "Because of this, said again. [f.pdf, p. 2]" }]);
    expect(out.fixed).toBe(1);
  });

  it("Explained: if the fixed section still cites a made-up page it is stripped, never shown", async () => {
    const fake = new FakeEngine({ text: explainedText("[f.pdf, p. 1]", "[f.pdf, p. 50]") });
    const out = await writeExplained(fake, input());
    expect(JSON.stringify(out.explained)).not.toContain("p. 50");
  });

  it("Explained: a citation alone on its line joins the sentence before it, so no empty line shows only 'p. 2'", async () => {
    const out = await writeExplained(new FakeEngine({ text: explainedText("[f.pdf, p. 2]") }), input());
    expect(out.explained.sections[1].blocks).toEqual([{ type: "paragraph", text: "Because of this. [f.pdf, p. 2] [f.pdf, p. 2]" }]);
  });

  it("Explained: a named thing the readings discuss that no section explains is added to the section where it matters, and nothing else changes", async () => {
    const notes = [
      { name: "Beta", aliases: [], kind: "concept", what: "The second idea.", passages: 2 },
      { name: "Gamma", aliases: [], kind: "person", what: "Named once.", passages: 1 },
    ];
    const add = "Beta is the second idea of the reading: it shows how the first one plays out in practice, and the answer depends on it. [f.pdf, p. 2]";
    const fake = new FakeEngine({ text: explainedText("[f.pdf, p. 1]"), json: { additions: [{ name: "Beta", section: 2, text: add }, { name: "Delta", section: 1, text: "Not asked about, so dropped by code." }] } });
    const out = await writeExplained(fake, input(notes));
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1].prompt).toMatch(/## Not yet explained[^\n]*\n- Beta \[concept\]/);
    expect(fake.calls[1].prompt).not.toContain("Gamma"); // named once: not held by the check
    expect(out.explained.sections[1].blocks.at(-1)).toEqual({ type: "paragraph", text: add });
    expect(JSON.stringify(out.explained)).not.toContain("Delta");
    expect(out.conceptsChecked).toBe(true);
  });

  it("Explained: a named thing that is only mentioned, not explained, counts as missing", async () => {
    const notes = [{ name: "Alpha", aliases: [], kind: "concept", what: "The first idea.", passages: 3 }];
    const fake = new FakeEngine({ text: explainedText("[f.pdf, p. 1]", "[f.pdf, p. 1]", "\nAlpha, Beta and Gamma. [f.pdf, p. 1]\n"), json: { additions: [] } });
    await writeExplained(fake, input(notes));
    expect(fake.calls[1].prompt).toMatch(/## Not yet explained[^\n]*\n- Alpha \[concept\]/);
  });

  it("Explained: too long rewrites only the longest section, to the words it should come to", async () => {
    const long = Array.from({ length: 80 }, () => "word").join(" ");
    const fake = new FakeEngine({ text: (r: AiRequest) => (r.system.includes("You fix one section") ? "## What is the first step?\n\nShorter now. [f.pdf, p. 1]" : explainedText("[f.pdf, p. 1]", "[f.pdf, p. 1]", `\n${long} [f.pdf, p. 1]\n`)) });
    const out = await writeExplained(fake, { ...input(), length: { target: 50, max: 70, min: 10 } });
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1].prompt).toMatch(/## The section to write again\n## What is the first step\?/);
    expect(fake.calls[1].prompt).toMatch(/Write it in about \d+ words/);
    expect(out.explained.sections[0].blocks).toEqual([{ type: "paragraph", text: "Shorter now. [f.pdf, p. 1]" }]);
  });

  it("Explained: without the brain's notes the named-things check waits for later", async () => {
    const out = await writeExplained(new FakeEngine({ text: explainedText("[f.pdf, p. 1]") }), input());
    expect(out.conceptsChecked).toBe(false);
  });

  it("Explained: text with no sections is written again whole, once; twice is an error", async () => {
    let n = 0;
    const fake = new FakeEngine({ text: () => (n++ === 0 ? "Sorry, here it is in prose with no headings." : explainedText("[f.pdf, p. 1]")) });
    await writeExplained(fake, input());
    expect(fake.calls).toHaveLength(2);
    await expect(writeExplained(new FakeEngine({ text: "no shape" }), input())).rejects.toThrow(/without its sections twice/);
  });
});
