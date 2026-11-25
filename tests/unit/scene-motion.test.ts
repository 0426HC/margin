import { describe, expect, it } from "vitest";
import { keyStep, labelAt, PX_PER_WEEK, wheelPixels, wheelStep } from "@/components/art/weekPick";
import { linesPlan, notebookRows } from "@/components/art/notebookLines";
import { keys, pickKey, seeded, weight } from "@/components/art/keyHops";
import { arc, call, hop, run, Script, think, wait } from "@/components/art/rig";

describe("Lecture notes: the wheel picks a week", () => {
  it("moves one sheet per 110 px, later weeks when scrolling down, and stays between sheets when stopped halfway", () => {
    expect(PX_PER_WEEK).toBe(110);
    expect(wheelStep(6, 110, 12)).toEqual({ pos: 7, capture: true });
    expect(wheelStep(6, 55, 12)).toEqual({ pos: 6.5, capture: true });
    expect(labelAt(6.5)).toEqual({ kind: "between", a: 6, b: 7 });
    expect(wheelStep(6.5, -55, 12)).toEqual({ pos: 6, capture: true });
    expect(labelAt(6)).toEqual({ kind: "on", index: 6 });
  });
  it("lets the page scroll past the last week (down) and the first week (up), and clamps on the way", () => {
    expect(wheelStep(11, 40, 12)).toEqual({ pos: 11, capture: false });
    expect(wheelStep(0, -40, 12)).toEqual({ pos: 0, capture: false });
    expect(wheelStep(10.5, 400, 12)).toEqual({ pos: 11, capture: true });
    expect(wheelStep(11, -40, 12).capture).toBe(true);
  });
  it("reads line- and page-based wheels in pixels", () => {
    expect(wheelPixels({ deltaY: 3, deltaMode: 1 })).toBe(48);
    expect(wheelPixels({ deltaY: 1, deltaMode: 2 }, 900)).toBe(900);
  });
  it("arrow keys move one week; from between two sheets they go to the nearer side's sheet", () => {
    expect(keyStep(6, 1, 12)).toBe(7);
    expect(keyStep(6, -1, 12)).toBe(5);
    expect(keyStep(6.4, 1, 12)).toBe(7);
    expect(keyStep(6.4, -1, 12)).toBe(6);
    expect(keyStep(11, 1, 12)).toBe(11);
    expect(keyStep(0, -1, 12)).toBe(0);
  });
});

describe("Note to Self: one written line per saved layer", () => {
  it("one ruled row per layer of the course, getting closer for a long course", () => {
    expect(notebookRows(11).rows).toHaveLength(11);
    expect(notebookRows(30).gap).toBeLessThan(notebookRows(8).gap);
    expect(notebookRows(0).rows).toEqual([]);
  });
  it("lines seen before are drawn at once; only new ones are written", () => {
    expect(linesPlan(4, 2)).toEqual({ instant: 2, write: [2, 3] });
    expect(linesPlan(4, 4)).toEqual({ instant: 4, write: [] });
    expect(linesPlan(4, null)).toEqual({ instant: 0, write: [0, 1, 2, 3] }); // never seen: write them all once
    expect(linesPlan(2, 5)).toEqual({ instant: 2, write: [] }); // a layer removed from Note to Self
    expect(linesPlan(0, 3)).toEqual({ instant: 0, write: [] });
  });
});

describe("Let's talk!: hopping on the keys", () => {
  it("has the letter keys and one space bar", () => {
    const all = keys();
    expect(all.filter((k) => k.space)).toHaveLength(1);
    expect(all).toHaveLength(13 * 5 - 5 + 1);
  });
  it("mostly the middle rows and columns, sometimes the space bar, rarely the edges, never the same key twice", () => {
    const all = keys();
    const rand = seeded(3);
    let at = all.find((k) => k.id === "2:6")!;
    const counts = { middle: 0, space: 0, edge: 0 };
    for (let i = 0; i < 4000; i++) {
      const next = pickKey(all, at, rand);
      expect(next.id).not.toBe(at.id);
      if (next.space) counts.space++;
      else if (next.row >= 1 && next.row <= 3 && next.col >= 3 && next.col <= 9) counts.middle++;
      else if (next.col <= 1 || next.col >= 11 || next.row === 0 || next.row === 4) counts.edge++;
      at = next;
    }
    expect(counts.middle / 4000).toBeGreaterThan(0.6);
    expect(counts.space).toBeGreaterThan(40);
    expect(counts.edge / 4000).toBeLessThan(0.15);
    expect(weight(at, at)).toBe(0);
  });
});

describe("the hero's choreography runner", () => {
  const still = { x: 0, y: 0, lift: 0, tilt: 0, think: 0 };
  it("a hop is a smooth arc that lands where it was going", () => {
    expect(arc(0.5, 10)).toBe(10);
    expect(arc(0, 10)).toBe(0);
    const s = new Script(still, () => [wait(10)]);
    s.push(hop({ x: 10, y: 0 }, 0.3, 16));
    expect(s.tick(0.15).lift).toBeCloseTo(16);
    const end = s.tick(0.15);
    expect([end.x, end.lift]).toEqual([10, 0]);
  });
  it("runs at a steady pace, reporting progress for the line drawing behind it, and thinks with a tilt and the dots", () => {
    const seen: number[] = [];
    const s = new Script(still, () => [wait(10)]);
    s.push(run({ x: 100, y: 0 }, 1, (t) => seen.push(t)), think(1.3));
    expect(s.tick(0.5).x).toBeCloseTo(50);
    s.tick(0.5);
    expect(seen.at(-1)).toBe(1);
    const mid = s.tick(0.65);
    expect(mid.tilt).toBeCloseTo(-10);
    expect(mid.think).toBeCloseTo(1);
    expect(s.tick(1).tilt).toBeCloseTo(0);
  });
  it("refills itself, so a loop is just a function", () => {
    let n = 0;
    const s = new Script(still, () => [wait(1), call(() => void n++)]);
    s.tick(3.5);
    expect(n).toBe(3);
  });
});
