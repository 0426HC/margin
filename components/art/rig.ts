"use client";

import { useEffect, useRef } from "react";
import { THINK_TILT, type Pose } from "./Hero";

/**
 * A tiny choreography runner for the hero. A scene queues steps (hop, run, think, wait, or a custom move); each step starts from wherever
 * the hero is when it begins. `tick` advances by real time and writes the pose; when the queue runs dry it asks the scene for more, so
 * loops are just a refill function. Pure, so it can be tested without a browser.
 */
export interface Move {
  dur: number;
  at: (t: number, pose: Pose) => void;
  end?: () => void;
}
export type Step = (from: Pose) => Move;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
/** Strong ease-out, the curve of the pencil spin. */
export const easeOut = (t: number) => 1 - (1 - t) ** 3;
/** The hop's height at t (0 to 1): a smooth arc up and down. */
export const arc = (t: number, h: number) => 4 * h * t * (1 - t);

/** A hop from where it is to (x, y): a smooth arc. Height in hero units. */
export const hop =
  (to: { x: number; y: number }, dur = 0.3, h = 16): Step =>
  (from) => ({
    dur,
    at: (t, p) => {
      const e = easeInOut(t);
      p.x = lerp(from.x, to.x, e);
      p.y = lerp(from.y, to.y, e);
      p.lift = arc(t, h);
      p.tilt = 0;
      p.think = 0;
    },
  });

/** Runs (little bobbing steps) to (x, y) at a steady pace; `onT` hears how far along it is, for the line drawing itself behind it. */
export const run =
  (to: { x: number; y: number }, dur: number, onT?: (t: number) => void): Step =>
  (from) => ({
    dur,
    at: (t, p) => {
      p.x = lerp(from.x, to.x, t);
      p.y = lerp(from.y, to.y, t);
      p.lift = Math.abs(Math.sin(t * dur * Math.PI * 7)) * 2.2;
      p.tilt = 0;
      p.think = 0;
      onT?.(t);
    },
  });

/** Tilts back and shows the thinking dots for `dur` seconds, easing in and out over 0.22 s. `onT` runs along (the pencil spin). */
export const think =
  (dur = 1.3, onT?: (t: number, secs: number) => void): Step =>
  () => ({
    dur,
    at: (t, p) => {
      const k = easeInOut(clamp01(Math.min((t * dur) / 0.22, ((1 - t) * dur) / 0.22)));
      p.tilt = THINK_TILT * k;
      p.think = k;
      p.lift = 0;
      onT?.(t, t * dur);
    },
  });

export const wait =
  (dur: number): Step =>
  () => ({ dur, at: (_t, p) => void ((p.lift = 0), (p.tilt = 0), (p.think = 0)) });

/** Runs `fn` once, taking no time. */
export const call =
  (fn: () => void): Step =>
  () => ({ dur: 0, at: () => {}, end: fn });

export class Script {
  pose: Pose;
  private queue: Step[] = [];
  private cur: { move: Move; t: number } | null = null;
  constructor(
    start: Pose,
    private refill: () => Step[],
  ) {
    this.pose = { ...start };
  }
  push(...steps: Step[]) {
    this.queue.push(...steps);
  }
  /** Advances by `dt` seconds. Returns the pose to draw. */
  tick(dt: number): Pose {
    let left = dt;
    for (let guard = 0; guard < 64; guard++) {
      if (!this.cur) {
        if (!this.queue.length) this.queue.push(...this.refill());
        const next = this.queue.shift();
        if (!next) break;
        this.cur = { move: next({ ...this.pose }), t: 0 };
      }
      const { move } = this.cur;
      const need = move.dur * (1 - this.cur.t);
      if (left < need) {
        this.cur.t += left / move.dur;
        move.at(this.cur.t, this.pose);
        break;
      }
      left -= need;
      if (move.dur > 0) move.at(1, this.pose);
      this.cur = null;
      move.end?.();
    }
    return this.pose;
  }
}

/** Runs `tick(dt)` on every animation frame while `active`, and not at all otherwise (dt is capped so a hidden tab doesn't jump). */
export function useFrameLoop(active: boolean, tick: (dt: number) => void) {
  const fn = useRef(tick);
  useEffect(() => {
    fn.current = tick;
  });
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      fn.current(Math.min(0.05, (now - last) / 1000));
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
}
