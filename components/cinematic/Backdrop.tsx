"use client";

import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import "./backdrop.css";
import { hashSeed, mix, rgbCss, rng, type Motif, type RGB } from "./theme";

type Props = {
  /** The project title: it seeds every random choice, so the look never changes between visits. */
  seed: string;
  accents: RGB[];
  motifs: Motif[];
  /** Fractional index into accents: 2.4 is 40% of the way from the third look to the fourth. */
  pos: MotionValue<number>;
  /** Topic icons per look; leave out for none. */
  icons?: LucideIcon[][];
  reduced: boolean;
  /**
   * Looks from this index on belong to scenes that fill the window (text left, an illustration filling the right half): their icons keep
   * to the empty margins of the text column, so they never cross the text or the illustration.
   */
  sideIconsFrom?: number;
};

type Ctx = { c: CanvasRenderingContext2D; w: number; h: number; t: number; a: RGB; px: number; py: number; shift: number; alpha: number; rand: () => number };

/** Slow terrain lines, like contour rows on a map. */
function contours({ c, w, h, t, a, px, py, shift, alpha, rand }: Ctx) {
  const rows = 26;
  const f1 = 0.0035 + rand() * 0.002;
  const f2 = 0.009 + rand() * 0.004;
  const phase = rand() * 6;
  c.lineWidth = 1;
  for (let k = 0; k < rows; k++) {
    const base = h * (0.04 + (k / rows) * 1.0) - shift * 0.35 + py * (0.2 + k * 0.01);
    c.beginPath();
    for (let x = -20; x <= w + 20; x += 22) {
      const y = base + 38 * (Math.sin(x * f1 + t * 0.00018 + k * 0.33 + phase + px * 0.004) + 0.55 * Math.sin(x * f2 - t * 0.00012 + k * 0.21));
      if (x === -20) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.strokeStyle = rgbCss(a, alpha * (0.1 + 0.16 * Math.sin((k / rows) * Math.PI)));
    c.stroke();
  }
}

/** Concentric ripples from two off-screen centres. */
function rings({ c, w, h, t, a, px, py, shift, alpha, rand }: Ctx) {
  const centres = [
    [w * (0.72 + rand() * 0.15), h * (0.3 + rand() * 0.2)],
    [w * (0.1 + rand() * 0.2), h * (0.75 + rand() * 0.2)],
  ];
  c.lineWidth = 1;
  centres.forEach(([cx, cy], n) => {
    for (let k = 0; k < 11; k++) {
      const r = ((k * 78 + t * 0.012 + shift * 0.25) % 858) + 20;
      const fade = 1 - r / 880;
      c.beginPath();
      c.arc(cx + px * (n ? 0.3 : 0.6), cy + py * (n ? 0.3 : 0.6) - shift * 0.1, r, 0, Math.PI * 2);
      c.strokeStyle = rgbCss(a, alpha * 0.24 * fade * fade);
      c.stroke();
    }
  });
}

/** Long, thin strokes drifting across the page like line-art. */
function drift({ c, w, h, t, a, px, py, shift, alpha, rand }: Ctx) {
  const n = 15;
  c.lineWidth = 1;
  for (let k = 0; k < n; k++) {
    const y0 = rand() * h * 1.3 - h * 0.15;
    const len = w * (0.5 + rand() * 0.6);
    const sp = 0.004 + rand() * 0.006;
    const bow = (rand() - 0.5) * 220;
    const x0 = (((rand() * (w + len) + t * sp * 40 + shift * 0.3) % (w + len)) - len) + px * 0.5;
    const y = y0 - shift * (0.1 + (k % 4) * 0.05) + py * 0.4;
    c.beginPath();
    c.moveTo(x0, y);
    c.quadraticCurveTo(x0 + len / 2, y + bow, x0 + len, y - bow * 0.3);
    c.strokeStyle = rgbCss(a, alpha * (0.12 + (k % 3) * 0.05));
    if (k % 4 === 0) c.setLineDash([2, 9]);
    c.stroke();
    c.setLineDash([]);
  }
}

/** Fine particles with three depths, rising slowly. */
function dots({ c, w, h, t, a, px, py, shift, alpha, rand }: Ctx) {
  for (let k = 0; k < 110; k++) {
    const depth = 0.3 + rand() * 0.9;
    const x = rand() * w + px * depth * 0.8;
    const y = (((rand() * h - t * 0.006 * depth - shift * depth * 0.4) % h) + h) % h + py * depth * 0.8;
    c.beginPath();
    c.arc(x, y, 0.8 + depth * 1.3, 0, Math.PI * 2);
    c.fillStyle = rgbCss(a, alpha * (0.14 + depth * 0.3));
    c.fill();
  }
}

/** A loose constellation: nodes on small orbits, joined when they come near. */
function web({ c, w, h, t, a, px, py, shift, alpha, rand }: Ctx) {
  const pts: [number, number][] = [];
  for (let k = 0; k < 30; k++) {
    const bx = rand() * w;
    const by = rand() * h;
    const r = 14 + rand() * 40;
    const sp = 0.00012 + rand() * 0.0002;
    const ph = rand() * 6.28;
    pts.push([bx + Math.cos(t * sp + ph) * r + px * 0.4, by + Math.sin(t * sp * 1.3 + ph) * r - shift * 0.12 + py * 0.4]);
  }
  c.lineWidth = 1;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
      if (d < 210) {
        c.beginPath();
        c.moveTo(pts[i][0], pts[i][1]);
        c.lineTo(pts[j][0], pts[j][1]);
        c.strokeStyle = rgbCss(a, alpha * 0.2 * (1 - d / 210));
        c.stroke();
      }
    }
  }
  for (const [x, y] of pts) {
    c.beginPath();
    c.arc(x, y, 2.2, 0, Math.PI * 2);
    c.fillStyle = rgbCss(a, alpha * 0.42);
    c.fill();
  }
}

const DRAW: Record<Motif, (x: Ctx) => void> = { contours, rings, drift, dots, web };

/**
 * Painting a full-screen gradient is the most expensive thing a canvas can do, so nothing full-screen is painted per frame:
 * - the desk, the vignette and the dark band under the text column are static CSS layers, painted once;
 * - each unit's three soft colour fields are one pre-painted layer, crossfaded with opacity as you scroll and drifting with a
 *   slow CSS transform, so the compositor moves them without repainting;
 * - the canvas holds only the thin line art, and redraws only while the page scrolls or the pointer moves, then rests.
 */
export function Backdrop({ seed, accents, motifs, pos, icons, reduced, sideIconsFrom = Infinity }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointer = useRef({ x: 0, y: 0, sx: 0, sy: 0 });
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const smx = useSpring(mx, { stiffness: 40, damping: 18 });
  const smy = useSpring(my, { stiffness: 40, damping: 18 });
  const fieldX = useTransform(smx, (v) => (reduced ? 0 : v * 72));
  const fieldY = useTransform(smy, (v) => (reduced ? 0 : v * 52));

  // Three soft colour fields per unit, placed by the seed, so the same course always opens the same way.
  const fields = useMemo(() => {
    const field = rng(hashSeed(seed) ^ 0x9e37);
    const orbit = Array.from({ length: 3 }, () => ({ ax: field(), ay: field(), r: 0.45 + field() * 0.3 }));
    return accents.map((a, i) => {
      const next = accents[Math.min(i + 1, accents.length - 1)];
      const b = mix(next, accents[(Math.min(i + 1, accents.length - 1) + 1) % accents.length], 0.5);
      return orbit
        .map((o, n) => `radial-gradient(circle ${Math.round(o.r * 100)}vmax at ${Math.round((0.15 + o.ax * 0.7) * 100)}% ${Math.round((0.15 + o.ay * 0.7) * 100)}%, ${rgbCss(n === 1 ? b : a, n === 0 ? 0.09 : 0.06)}, transparent)`)
        .join(", ");
    });
  }, [seed, accents]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const base = hashSeed(seed);
    let w = 0;
    let h = 0;
    let raf = 0;
    let lastKey = "";
    let clock = 0; // ambient time only moves while the page is moving, so resting costs nothing and nothing jumps
    let lastT = 0;
    let awakeUntil = 0;

    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = window.innerWidth;
      h = window.innerHeight;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lastKey = "";
    };
    size();

    const frame = (t: number) => {
      const p = Math.min(Math.max(pos.get(), 0), accents.length - 1);
      const i = Math.min(Math.floor(p), accents.length - 1);
      const j = Math.min(i + 1, accents.length - 1);
      const f = p - i;
      const pt = pointer.current;
      pt.sx += (pt.x - pt.sx) * 0.04;
      pt.sy += (pt.y - pt.sy) * 0.04;
      const px = reduced ? 0 : pt.sx * 36;
      const py = reduced ? 0 : pt.sy * 26;
      ctx.clearRect(0, 0, w, h);
      const shift = p * 220;
      const layers: [Motif, number, RGB][] = [[motifs[i], 1 - f, accents[i]]];
      if (j !== i) layers.push([motifs[j], f, accents[j]]);
      for (const [m, alpha, col] of layers) {
        if (alpha <= 0.01) continue;
        // A fresh generator per draw keeps every frame's shapes identical.
        DRAW[m]({ c: ctx, w, h, t: reduced ? 0 : t, a: col, px, py, shift, alpha, rand: rng(base ^ hashSeed(m)) });
      }
    };

    const loop = (t: number) => {
      clock += Math.min(t - lastT, 50);
      lastT = t;
      frame(clock);
      const pt = pointer.current;
      const settling = Math.abs(pt.x - pt.sx) + Math.abs(pt.y - pt.sy) > 0.002;
      raf = t < awakeUntil || settling ? requestAnimationFrame(loop) : 0;
    };
    const wake = () => {
      awakeUntil = performance.now() + 1200;
      if (!raf)
        raf = requestAnimationFrame((t) => {
          lastT = t;
          loop(t);
        });
    };
    const still = () => {
      const key = `${Math.round(pos.get() * 4)}:${w}x${h}`;
      if (key !== lastKey) {
        lastKey = key;
        frame(0);
      }
    };

    const onMove = (e: PointerEvent) => {
      pointer.current.x = e.clientX / window.innerWidth - 0.5;
      pointer.current.y = e.clientY / window.innerHeight - 0.5;
      mx.set(pointer.current.x);
      my.set(pointer.current.y);
      wake();
    };
    const onResize = () => {
      size();
      if (reduced) still();
      else wake();
    };
    window.addEventListener("resize", onResize);
    let unsub = () => {};
    if (reduced) {
      still();
      unsub = pos.on("change", still);
    } else {
      window.addEventListener("pointermove", onMove);
      unsub = pos.on("change", wake);
      wake();
    }
    return () => {
      cancelAnimationFrame(raf);
      unsub();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onMove);
    };
  }, [seed, accents, motifs, pos, reduced, mx, my]);

  return (
    <div className="bd" aria-hidden="true">
      <motion.div className="bd-fields" style={{ x: fieldX, y: fieldY }}>
        {fields.map((bg, i) => (
          <Field key={i} index={i} pos={pos} background={bg} reduced={reduced} />
        ))}
      </motion.div>
      <div className="bd-shade" />
      <canvas ref={canvas} />
      {icons && (
        <div className="bd-icons">
          {icons.map((set, i) => (
            <IconGroup key={i} index={i} set={set} accent={accents[i]} seed={seed} pos={pos} mx={smx} my={smy} reduced={reduced} side={i >= sideIconsFrom} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One unit's colour fields: fully there at its own scene, fading out toward its neighbours. */
function Field({ index, pos, background, reduced }: { index: number; pos: MotionValue<number>; background: string; reduced: boolean }) {
  const opacity = useTransform(pos, (p) => Math.max(0, 1 - Math.abs(p - index)));
  // A field out of sight is hidden, so its endless drift isn't composited for nothing (a long course has one per week).
  const visibility = useTransform(opacity, (o) => (o > 0 ? "visible" : "hidden"));
  return <motion.div className="bd-field" data-still={reduced ? "" : undefined} style={{ opacity, visibility, background, animationDelay: `${-index * 17}s` }} />;
}

/** Three topic icons for one unit. They fade in with the unit, drift with the scroll and lean away from the cursor. */
function IconGroup({
  index,
  set,
  accent,
  seed,
  pos,
  mx,
  my,
  reduced,
  side,
}: {
  index: number;
  set: LucideIcon[];
  accent: RGB;
  seed: string;
  pos: MotionValue<number>;
  mx: MotionValue<number>;
  my: MotionValue<number>;
  reduced: boolean;
  side: boolean;
}) {
  const opacity = useTransform(pos, (p) => Math.max(0, 1 - Math.abs(p - index) * 1.7));
  // Clamped to where the group can still be seen: further away it stays put, so the icons of every other week aren't moved (and
  // restyled) on every frame of the scroll, and they are hidden, so their float animations stop costing anything.
  const scroll = useTransform(pos, (p) => (reduced ? 0 : Math.max(-1, Math.min(1, p - index)) * -190));
  const visibility = useTransform(opacity, (o) => (o > 0 ? "visible" : "hidden"));
  const r = rng(hashSeed(`${seed}:icons:${index}`));
  // Three slots around the edges of the screen, away from the headline column and the labels.
  const slots = side
    ? // above and below the text column (vertically centred in the scene), left of where the illustration starts
      [
        { x: 4 + r() * 5, y: 15 + r() * 4 },
        { x: 13 + r() * 9, y: 82 + r() * 4 },
        { x: 27 + r() * 5, y: 89 + r() * 2 },
      ]
    : [
        { x: 40 + r() * 14, y: 7 + r() * 8 },
        { x: 66 + r() * 22, y: 83 + r() * 7 },
        { x: 33 + r() * 14, y: 82 + r() * 8 },
      ];
  return (
    <motion.div className="bd-icons" style={{ opacity, visibility }}>
      {set.map((Icon, k) => {
        const depth = 0.6 + r() * 1.2;
        const size = side ? 44 + r() * 16 : 54 + r() * 40;
        return (
          <Floating key={k} depth={depth} scroll={scroll} mx={mx} my={my} reduced={reduced} style={{ left: `${slots[k].x}%`, top: `${slots[k].y}%` }}>
            <Icon size={size} strokeWidth={1} color={rgbCss(accent, 0.42)} style={{ animation: reduced ? "none" : `bd-float ${9 + k * 3}s ease-in-out ${-k * 4}s infinite alternate` }} />
          </Floating>
        );
      })}
    </motion.div>
  );
}

function Floating({
  depth,
  scroll,
  mx,
  my,
  reduced,
  style,
  children,
}: {
  depth: number;
  scroll: MotionValue<number>;
  mx: MotionValue<number>;
  my: MotionValue<number>;
  reduced: boolean;
  style: React.CSSProperties;
  children: React.ReactNode;
}) {
  const x = useTransform(mx, (v) => (reduced ? 0 : v * -46 * depth));
  const y = useTransform([my, scroll], ([v, s]: number[]) => (reduced ? 0 : v * -34 * depth + s * depth));
  return (
    <motion.div className="bd-icon" style={{ ...style, x, y }}>
      {children}
    </motion.div>
  );
}
