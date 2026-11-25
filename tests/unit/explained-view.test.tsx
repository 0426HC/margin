/** The Explained tab on screen: its shape in order with no table of terms, a draft as it streams in, an old explanation still shown, and no line that is only a page number. */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExplainedView } from "@/components/layers/LayerReading";
import type { ExplainedLayer } from "@/lib/ai/schemas";
import { readExplained } from "@/lib/layers/explained-text";

const C = "[Clogg.pdf, p. 4]";
const v2: ExplainedLayer = {
  version: 2,
  question: "Why did the Greek revolt begin in 1821?",
  summary: "Ottoman rule loosened. Greek merchants grew rich and read new ideas. A secret society planned the rising.",
  sections: [
    { question: "How did Ottoman rule work?", blocks: [{ type: "paragraph", text: `The millet system let the Church govern Christians. ${C}` }, { type: "paragraph", text: C }] },
    { question: "Why did merchants matter?", blocks: [{ type: "bullets", items: [`They funded schools. ${C}`, "[Clogg.pdf, p. 5]"] }] },
  ],
  soWhat: "The rising grew from these changes, which the next layer follows into the war itself.",
};

const show = (explained: ExplainedLayer) => render(<ExplainedView explained={explained} optional={[]} onCite={vi.fn()} onMounted={() => {}} />);

describe("the Explained tab", () => {
  it("shows the summary, the big question, a section per sub-question, then the so what, in that order, and no table of terms", () => {
    const { container } = show(v2);
    const text = container.textContent!;
    const at = (t: string) => text.indexOf(t);
    expect(at("Summary")).toBeLessThan(at("The big question"));
    expect(at("Why did the Greek revolt begin in 1821?")).toBeLessThan(at("How did Ottoman rule work?"));
    expect(at("Why did merchants matter?")).toBeLessThan(at("So what"));
    expect(screen.getByRole("heading", { name: "How did Ottoman rule work?" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(text).not.toMatch(/Key concepts|Also mentioned/);
  });

  it("shows a draft as it streams in: the sections written so far, an unfinished citation left off, no so what until it comes", () => {
    const draft = readExplained(`# Summary\nOttoman rule loosened and merchants grew rich.\n\n## How did Ottoman rule work?\nThe millet system let the Church govern Christians. ${C}\n\nThe Patriarch answered to the sultan [Clogg.pdf, p.`, { final: false });
    const { container } = render(<ExplainedView writing explained={{ ...draft, version: 2, question: "Why?" }} optional={[]} onCite={vi.fn()} onMounted={() => {}} />);
    expect(screen.getByRole("heading", { name: "How did Ottoman rule work?" })).toBeInTheDocument();
    expect(container.textContent).toContain("The Patriarch answered to the sultan");
    expect(container.textContent).not.toContain("[Clogg.pdf, p.");
    expect(container.textContent).not.toContain("So what");
    expect(screen.queryByRole("tabpanel")).toBeNull();
  });

  it("never shows a line that is only a page number: a lone citation joins the line before it", () => {
    const { container } = show(v2);
    for (const p of container.querySelectorAll(".m-row > p, .m-row li")) expect(p.textContent!.trim().length).toBeGreaterThan(0);
    const old: ExplainedLayer = { summary: "An older explanation of the layer, written before the new shape existed.", blocks: [{ type: "heading", text: "Basics" }, { type: "paragraph", text: `A fact. ${C}` }, { type: "paragraph", text: "[Clogg.pdf, p. 5]" }], soWhat: "It matters for the course." };
    const again = show(old);
    expect([...again.container.querySelectorAll(".m-row > p")].every((p) => p.textContent!.trim())).toBe(true);
  });

  it("still shows an explanation written before the new shape, as it was", () => {
    show({ summary: "An older explanation of the layer, written before the new shape existed.", blocks: [{ type: "heading", text: "Basics" }, { type: "paragraph", text: `A fact. ${C}` }], soWhat: "It matters for the course." });
    expect(screen.getByRole("heading", { name: "Basics" })).toBeInTheDocument();
    expect(screen.queryByText("The big question")).toBeNull();
  });
});
