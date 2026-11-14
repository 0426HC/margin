import { describe, expect, it } from "vitest";
import { PALETTES, pairsOf } from "@/app/design-lab/palette/palettes";
import { contrast, hexToRgb } from "@/lib/ui/contrast";

function hue(hex: string) {
  const [x, y, z] = hexToRgb(hex).map((v) => v / 255);
  const mx = Math.max(x, y, z);
  const d = mx - Math.min(x, y, z);
  if (d < 0.08) return null;
  const h = mx === x ? ((y - z) / d) % 6 : mx === y ? (z - x) / d + 2 : (x - y) / d + 4;
  return (h * 60 + 360) % 360;
}

describe("palette lab candidates", () => {
  for (const p of PALETTES) {
    for (const mode of ["dark", "light"] as const) {
      it(`${p.name} (${mode}) has no green, yellow, gold, olive or brown`, () => {
        const hexes = Object.values(p[mode]).concat(Object.values(p.agents));
        // warm 20-75 covers brown, gold, mustard and olive; 75-175 is green
        const warm = hexes.filter((h) => {
          const x = hue(h);
          return x !== null && x > 20 && x < 175;
        });
        expect(warm).toEqual([]);
        for (const h of p.unitHues) expect(h > 20 && h < 175).toBe(false);
      });
      it(`${p.name} (${mode}) meets contrast for every text and mark pair`, () => {
        for (const r of pairsOf(p[mode])) expect(contrast(r.fg, r.bg), r.label).toBeGreaterThanOrEqual(r.min);
      });
    }
  }
});
