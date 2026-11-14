import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The motion rule: components animate transform and opacity only. The one exception is pane width while the
// left pane collapses (grid-template-columns), because animating transform there would distort the text.
const LAYOUT = /\b(width|height|top|left|right|bottom|margin(?:-[a-z]+)?|padding(?:-[a-z]+)?)\b/;

function files(dir: string, ext: RegExp, out: string[] = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) files(p, ext, out);
    else if (ext.test(f)) out.push(p);
  }
  return out;
}

describe("motion rules", () => {
  const css = files("app/styles", /\.css$/);
  const tsx = files("components", /\.tsx$/);

  it("CSS transitions never animate layout properties", () => {
    const bad: string[] = [];
    for (const f of css) {
      for (const m of readFileSync(f, "utf8").matchAll(/transition:([^;]+);/g)) {
        if (LAYOUT.test(m[1])) bad.push(`${f}: ${m[0].trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("the only layout transition is the annotated pane collapse", () => {
    const hits = css.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/transition:[^;]*grid-template-columns[^;]*;[^\n]*/g)].map((m) => m[0]));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(/the one layout transition/);
  });

  it("keyframes only touch transform and opacity", () => {
    const bad: string[] = [];
    for (const f of css) {
      for (const m of readFileSync(f, "utf8").matchAll(/@keyframes [\w-]+\s*\{([^@]*?\}\s*)\}/g)) {
        for (const d of m[1].matchAll(/([a-z-]+)\s*:/g)) {
          if (LAYOUT.test(d[1])) bad.push(`${f}: ${d[1]}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("Motion props in components animate transform and opacity only", () => {
    const bad: string[] = [];
    for (const f of tsx) {
      for (const m of readFileSync(f, "utf8").matchAll(/(?:animate|initial|exit)=\{\{([^}]*)\}\}/g)) {
        if (LAYOUT.test(m[1])) bad.push(`${f}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
