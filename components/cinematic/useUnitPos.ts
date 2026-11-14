"use client";

import { useMotionValue, useMotionValueEvent, useScroll } from "motion/react";
import { useEffect, useState, type RefObject } from "react";
import { mix, rgbCss, type RGB } from "./theme";

const smooth = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/**
 * Where the reader is among the units, as a fractional index. Each unit's look blends into the next
 * while its scene slides in. Also writes `--unit-now`, the blended colour, onto the root element.
 */
export function useUnitPos(scenes: RefObject<(HTMLElement | null)[]>, count: number, accents: RGB[], root: RefObject<HTMLElement | null>, vpKey: string) {
  const pos = useMotionValue(0);
  const { scrollY } = useScroll();
  const [tops, setTops] = useState<number[]>([]);

  useEffect(() => {
    const measure = () => setTops(scenes.current.slice(0, count).map((el) => (el ? el.getBoundingClientRect().top + window.scrollY : 0)));
    measure();
    // Fonts and the scenes' own heights settle after first paint.
    const id = window.setTimeout(measure, 600);
    return () => window.clearTimeout(id);
  }, [scenes, count, vpKey]);

  const update = (y: number) => {
    if (tops.length < count) return;
    const vh = window.innerHeight;
    let p = 0;
    for (let i = 1; i < count; i++) p += smooth((y - (tops[i] - vh * 0.95)) / (vh * 0.7));
    pos.set(p);
    const i = Math.min(Math.floor(p), count - 1);
    const c = mix(accents[i], accents[Math.min(i + 1, count - 1)], p - i);
    root.current?.style.setProperty("--unit-now", rgbCss(c));
  };
  useMotionValueEvent(scrollY, "change", update);
  useEffect(() => update(window.scrollY));
  return pos;
}
