/** Reading Explained from the text Claude streams: the whole text, any prefix of it while it is written, and a section sent back. */
import { describe, expect, it } from "vitest";
import { isComplete, readExplained, readSection, sectionText } from "@/lib/layers/explained-text";

const C = "[Clogg.pdf, p. 4]";
const full = `# Summary
Ottoman rule loosened and Greek merchants grew rich.
They read new ideas.

## How did Ottoman rule work?
The millet system let the **Church** govern Christians. ${C}

It made the Patriarch powerful. ${C}

- First point. ${C}
- Second point.

Table: The four kinds of rule
| Kind | Who | Why |
| --- | --- | --- |
| Direct | Pashas | Taxes ${C} |
| Indirect | The Church | Order |

## Why did merchants matter?
1. They funded schools. ${C}
2. They read Voltaire.

# So what
The rising grew from these changes.`;

describe("readExplained", () => {
  it("reads the summary, each section's paragraphs, bullets and table, and the so what", () => {
    const d = readExplained(full);
    expect(d.summary).toBe("Ottoman rule loosened and Greek merchants grew rich. They read new ideas.");
    expect(d.sections.map((s) => s.question)).toEqual(["How did Ottoman rule work?", "Why did merchants matter?"]);
    expect(d.sections[0].blocks).toEqual([
      { type: "paragraph", text: `The millet system let the Church govern Christians. ${C}` },
      { type: "paragraph", text: `It made the Patriarch powerful. ${C}` },
      { type: "bullets", items: [`First point. ${C}`, "Second point."] },
      { type: "table", caption: "The four kinds of rule", columns: ["Kind", "Who", "Why"], rows: [["Direct", "Pashas", `Taxes ${C}`], ["Indirect", "The Church", "Order"]], source: "" },
    ]);
    expect(d.sections[1].blocks).toEqual([{ type: "bullets", items: [`They funded schools. ${C}`, "They read Voltaire."] }]);
    expect(d.soWhat).toBe("The rising grew from these changes.");
    expect(isComplete(d)).toBe(true);
  });

  it("reads any prefix while it streams: what is there so far, an unfinished citation left off, never an error", () => {
    for (let i = 0; i < full.length; i += 7) expect(() => readExplained(full.slice(0, i), { final: false })).not.toThrow();
    const cut = readExplained(`${full.split("## Why")[0]}## Why did merchants matter?\n1. They funded schools [Clogg.pdf, p.`, { final: false });
    expect(cut.sections).toHaveLength(2);
    expect(cut.sections[1].blocks).toEqual([{ type: "bullets", items: ["They funded schools"] }]);
    expect(cut.soWhat).toBe("");
    expect(isComplete(cut)).toBe(false);
  });

  it("a section written back reads as one section, and keeps the old question when the answer leaves its heading off", () => {
    const d = readExplained(full);
    expect(readSection(sectionText(d.sections[0]), "x")).toEqual(d.sections[0]);
    expect(readSection(`Plain text with no heading. ${C}`, "Why?")).toEqual({ question: "Why?", blocks: [{ type: "paragraph", text: `Plain text with no heading. ${C}` }] });
    expect(readSection("", "Why?")).toBeNull();
  });
});

describe("smaller headings", () => {
  it("a ### heading inside a section stays in that section as a line of its text, never a new section", () => {
    const d = readExplained(`# Summary\nGist.\n\n## Why did it happen?\n### The patriarch\nHe ran the Church. ${C}\n\n## What followed?\nWar. ${C}\n\n# So what\nIt mattered.`);
    expect(d.sections.map((s) => s.question)).toEqual(["Why did it happen?", "What followed?"]);
    expect(d.sections[0].blocks).toEqual([{ type: "paragraph", text: "The patriarch" }, { type: "paragraph", text: `He ran the Church. ${C}` }]);
  });
});
