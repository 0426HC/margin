"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useRef } from "react";
import type { Rect } from "./transit";
import { rgbCss, type RGB } from "./theme";

export type CurtainMode = "expand" | "contract" | "fade-in" | "fade-out" | "hold";

/** The surface a project tile is made of, so the curtain can be that tile growing to fill the screen. */
export const surface = (accent: RGB) =>
  `radial-gradient(120% 100% at 28% 0%, ${rgbCss(accent, 0.38)}, rgb(17 24 39 / 0) 70%), linear-gradient(#1a2338, #111827)`;

/**
 * A full-screen sheet in the project's colour. "expand" grows from a tile's rectangle to the whole
 * screen; "contract" is the same in reverse; the fades cover or uncover the screen in place.
 * Clip-path is the one non-composited property here: it is a single 0.7s moment, not a scroll effect.
 */
export function Curtain({ mode, rect, accent, onDone }: { mode: CurtainMode; rect: Rect | null; accent: RGB; onDone: () => void }) {
  const t = useMotionValue(0);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  const box = mode === "expand" || mode === "contract";
  useEffect(() => {
    if (mode === "hold") return;
    const controls = animate(t, 1, {
      duration: box ? 0.72 : mode === "fade-in" ? 0.22 : 0.7,
      ease: box ? [0.65, 0, 0.35, 1] : "easeOut",
      onComplete: () => done.current(),
    });
    return () => controls.stop();
  }, [t, box, mode]);

  const clipPath = useTransform(t, (v) => {
    if (!box || !rect) return "inset(0px)";
    const k = mode === "expand" ? 1 - v : v;
    const r = typeof window === "undefined" ? 1440 : window.innerWidth;
    const b = typeof window === "undefined" ? 900 : window.innerHeight;
    return `inset(${rect.y * k}px ${(r - rect.x - rect.w) * k}px ${(b - rect.y - rect.h) * k}px ${rect.x * k}px round ${8 * k}px)`;
  });
  const opacity = useTransform(t, (v) => (mode === "hold" ? 1 : mode === "fade-in" ? v : mode === "fade-out" ? 1 - v : mode === "contract" ? 1 - Math.max(0, (v - 0.85) / 0.15) : 1));

  return <motion.div className="curtain" aria-hidden="true" style={{ clipPath, opacity, background: surface(accent) }} />;
}
