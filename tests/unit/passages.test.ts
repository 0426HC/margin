import { describe, expect, it } from "vitest";
import { makePassages } from "@/lib/import/passages";
import type { Block, Section } from "@/lib/import/types";

let seed = 0;
const words = (n: number) => Array.from({ length: n }, () => `w${++seed}`).join(" ");
const sentences = (n: number, each: number) => Array.from({ length: n }, () => `${words(each)}.`).join(" ");
const section = (blocks: Block[]): Section => ({
  title: "t",
  blocks,
  pageStart: Math.min(...blocks.map((b) => b.page)),
  pageEnd: Math.max(...blocks.map((b) => b.page)),
  wordCount: 0,
});
const w = (s: string) => s.split(/\s+/).filter(Boolean);

describe("makePassages", () => {
  const blocks: Block[] = [
    { kind: "paragraph", text: sentences(20, 12), page: 4 }, // 240 words on page 4
    { kind: "paragraph", text: sentences(5, 10), page: 4 },
    { kind: "paragraph", text: sentences(30, 10), page: 5 },
    { kind: "paragraph", text: "Short end.", page: 6 },
  ];
  const ps = makePassages(section(blocks));

  it("keeps every word, in order", () => {
    expect(w(ps.map((x) => x.text).join(" "))).toEqual(w(blocks.map((b) => b.text).join(" ")));
  });

  it("never spans pages, and the page is the page the text came from", () => {
    for (const x of ps) {
      const owners = blocks.filter((b) => b.text.includes(w(x.text)[0]));
      expect(owners.map((b) => b.page)).toEqual([x.page]);
      expect(owners[0].text).toContain(x.text.slice(0, 40));
    }
    expect(ps.map((x) => x.page)).toEqual([...ps.map((x) => x.page)].sort((a, b) => a - b));
    expect(new Set(ps.map((x) => x.page))).toEqual(new Set([4, 5, 6]));
  });

  it("makes passages of about 180 words", () => {
    const big = ps.filter((x) => w(x.text).length > 40);
    for (const x of big) expect(w(x.text).length).toBeLessThanOrEqual(240);
    expect(ps.filter((x) => x.page === 5).length).toBeGreaterThanOrEqual(2);
  });

  it("numbers passages in order from zero", () => {
    expect(ps.map((x) => x.ordinal)).toEqual(ps.map((_, i) => i));
  });
});
