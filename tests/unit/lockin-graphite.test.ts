import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrast, hexToRgb } from "@/lib/ui/contrast";

const tokens = readFileSync("app/styles/tokens.css", "utf8");
const lockin = readFileSync("app/styles/lockin.css", "utf8");

/** The lock in block of tokens.css: only what <html data-lockin> changes. */
const block = tokens.slice(tokens.indexOf("html[data-lockin] {"), tokens.indexOf("}", tokens.indexOf("html[data-lockin] {")));
const raw = (name: string) => tokens.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];

describe("Graphite (lock in colours)", () => {
  it("has the brief's exact colours as tokens", () => {
    expect(raw("graphite")).toBe("#0e0f11");
    expect(raw("graphite-surface")).toBe("#16181b");
    expect(raw("graphite-border")).toBe("#26292e");
    expect(raw("graphite-text")).toBe("#ececee");
    expect(raw("graphite-quiet")).toBe("#8b8f97");
    expect(raw("graphite-sheet")).toBe("#1b1d21");
    expect(raw("graphite-sheet-text")).toBe("#e3e4e8");
    expect(raw("plum")).toBe("#d38ae0");
    expect(raw("plum-strong")).toBe("#6b2c7e");
  });

  it("applies only under html[data-lockin], so normal mode keeps midnight and plum", () => {
    expect(block).toMatch(/--desk:\s*var\(--graphite\)/);
    expect(block).toMatch(/--paper:\s*var\(--graphite-sheet\)/);
    expect(block).toMatch(/--ink:\s*var\(--graphite-sheet-text\)/);
    expect(block).toMatch(/--accent:\s*var\(--graphite-text\)/); // primary buttons: #ececee
    expect(block).toMatch(/--accent-on:\s*var\(--graphite\)/); // with #0e0f11 text
    // the default (normal) desk and paper are unchanged
    expect(tokens).toMatch(/:root \{\s*\/\* ---------- 1\. raw palette[\s\S]*--desk: var\(--midnight\);/);
    expect(tokens).toMatch(/--paper: var\(--porcelain\);/);
  });

  it("keeps text readable", () => {
    const pairs: [string, string, number][] = [
      ["#ececee", "#0e0f11", 4.5],
      ["#8b8f97", "#0e0f11", 4.5],
      ["#8b8f97", "#16181b", 4.5],
      ["#e3e4e8", "#1b1d21", 4.5],
      ["#8b8f97", "#1b1d21", 4.5],
      ["#d38ae0", "#16181b", 4.5],
      ["#0e0f11", "#ececee", 4.5],
      ["#ececee", "#6b2c7e", 4.5],
    ];
    for (const [fg, bg, min] of pairs) expect(contrast(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
  });

  it("has no green, yellow or gold", () => {
    const hexes = [...block.matchAll(/#[0-9a-f]{6}/gi), ...lockin.matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0]);
    for (const h of hexes) {
      const [r, g, b] = hexToRgb(h);
      const warmOrGreen = g > b + 12 && g >= r - 30; // greens, yellows and golds all have green well above blue
      expect(warmOrGreen, h).toBe(false);
    }
  });

  it("fades over half a second and stops every other animation", () => {
    expect(lockin).toMatch(/::view-transition-old\(root\)[\s\S]*animation-duration:\s*500ms/);
    expect(lockin).toMatch(/html\[data-lockin\][^{]*\{[^}]*animation-duration:\s*0s !important[^}]*transition-duration:\s*0s !important/);
  });
});
