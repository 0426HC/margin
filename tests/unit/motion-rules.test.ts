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

describe("the course page's scenes move on their own scroll timelines", () => {
  const css = readFileSync("components/cinematic/overview.css", "utf8");
  it("a moment of a scene's scroll maps onto its view timeline: the first window's height is entry, the rest contain", async () => {
    const { ENTER, scrollRange, timelineAt } = await import("@/components/cinematic/geometry");
    expect(timelineAt(0)).toBe("entry 0%");
    expect(timelineAt(ENTER / 2)).toBe("entry 50%");
    expect(timelineAt(ENTER)).toBe("entry 100%");
    expect(timelineAt(ENTER + (1 - ENTER) / 4)).toBe("contain 25%");
    expect(timelineAt(1)).toBe("contain 100%");
    expect(scrollRange(0.02, ENTER * 0.8)).toBe("entry 7.6% entry 80%");
  });
  it("the headline's middle keyframe matches the geometry it comes from", async () => {
    const { TITLE_MID } = await import("@/components/cinematic/geometry");
    const at = /@keyframes ov-title-in \{[^]*?\n\s*([\d.]+)% \{ transform: translate\(var\(--x0\), var\(--y0\)\) scale\(var\(--big\)\)/.exec(css)?.[1];
    expect(Number(at)).toBeCloseTo(TITLE_MID * 100, 2);
  });
  it("the scenes' animations move only transform and opacity (so the compositor can play them), with no custom property for a curve", () => {
    const frames = [...css.matchAll(/@keyframes (ov-[a-z-]+) \{([^]*?)\n?\}\n/g)].filter((m) => /^ov-(fade|ink|grow-x|lift|nudge|rise|title-in|intro-[a-z]+)$/.test(m[1]));
    expect(frames.length).toBeGreaterThanOrEqual(9);
    for (const [, name, body] of frames) {
      const props = [...body.matchAll(/([a-z-]+):/g)].map((m) => m[1]).filter((p) => p !== "animation-timing-function");
      expect(props.every((p) => p === "transform" || p === "opacity"), `${name}: ${props.join(", ")}`).toBe(true);
      expect(body).not.toMatch(/animation-timing-function: var\(/);
    }
  });
});
