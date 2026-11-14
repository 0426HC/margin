import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agentColours, desk, mastery, paper, pairs, unitHues } from "@/app/style-guide/palette";
import { contrast, hexToRgb } from "@/lib/ui/contrast";
import { unitAccents } from "@/components/cinematic/theme";

const tokens = readFileSync("app/styles/tokens.css", "utf8");

function hue([r, g, b]: [number, number, number]) {
  const [x, y, z] = [r / 255, g / 255, b / 255];
  const mx = Math.max(x, y, z);
  const d = mx - Math.min(x, y, z);
  if (d < 0.08) return null; // greys have no hue to speak of
  let h = mx === x ? ((y - z) / d) % 6 : mx === y ? (z - x) / d + 2 : (x - y) / d + 4;
  h = (h * 60 + 360) % 360;
  return h;
}
const isGreen = (hex: string) => {
  const h = hue(hexToRgb(hex));
  return h !== null && h > 75 && h < 175;
};

describe("palette", () => {
  it("every swatch shown in the style guide matches tokens.css", () => {
    for (const s of [...desk, ...paper, ...mastery, ...agentColours]) {
      expect(tokens, `${s.token} is missing from tokens.css`).toMatch(new RegExp(`${s.token}:\\s*${s.hex}`, "i"));
    }
  });

  it("has no green anywhere in tokens.css", () => {
    const hexes = [...tokens.matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0]);
    expect(hexes.length).toBeGreaterThan(20);
    expect(hexes.filter(isGreen)).toEqual([]);
  });

  it("keeps unit and project accents out of green and red", () => {
    for (const u of unitHues) expect(u.hue > 75 && u.hue < 175, `${u.name} is green`).toBe(false);
    for (const u of unitHues) expect(u.hue > 340 || u.hue < 15, `${u.name} is red`).toBe(false);
    for (const title of ["The Federalist Papers", "Cell Biology", "Intro to Microeconomics"]) {
      for (const [r, g, b] of unitAccents(title, 8)) {
        const h = hue([r, g, b]);
        expect(h !== null && h > 75 && h < 175).toBe(false);
      }
    }
  });

  it("every text and mark pair meets its contrast minimum", () => {
    for (const p of pairs) expect(contrast(p.fg, p.bg), p.label).toBeGreaterThanOrEqual(p.min);
  });
});
