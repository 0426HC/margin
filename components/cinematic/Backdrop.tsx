"use client";

import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react";
import { useEffect, useRef } from "react";
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
};

/** The overhead lamp desk, the same as --desk-gradient in tokens.css: navy-indigo at the top centre, deep navy at the edges, a faint plum glow top left. */
function paintDesk(c: CanvasRenderingContext2D, w: number, h: number) {
  const lamp = c.createRadialGradient(w / 2, 0, 0, w / 2, 0, Math.max(w * 0.9, h * 0.75 * 1.4));
  lamp.addColorStop(0, "#1f2a48");
  lamp.addColorStop(0.45, "#152036");
  lamp.addColorStop(0.75, "#0f1626");
  lamp.addColorStop(1, "#0a0f1b");
  c.fillStyle = lamp;
  c.fillRect(0, 0, w, h);
  const plum = c.createRadialGradient(0, 0, 0, 0, 0, Math.max(w * 0.6, h * 0.5));
  plum.addColorStop(0, "rgb(125 44 146 / 0.13)");
  plum.addColorStop(0.7, "rgb(125 44 146 / 0)");
  c.fillStyle = plum;
  c.fillRect(0, 0, w, h);
}

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

export function Backdrop({ seed, accents, motifs, pos, icons, reduced }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointer = useRef({ x: 0, y: 0, sx: 0, sy: 0 });
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const smx = useSpring(mx, { stiffness: 40, damping: 18 });
  const smy = useSpring(my, { stiffness: 40, damping: 18 });

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const base = hashSeed(seed);
    const field = rng(base ^ 0x9e37);
    // Three soft colour fields, each with its own slow orbit.
    const orbit = Array.from({ length: 3 }, () => ({ ax: field(), ay: field(), sx: 0.4 + field(), sy: 0.4 + field(), ph: field() * 6.28, r: 0.45 + field() * 0.3 }));
    let w = 0;
    let h = 0;
    let raf = 0;
    let lastKey = "";

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
      const now = reduced ? 0 : t;
      const a = mix(accents[i], accents[j], f);
      const b = mix(accents[j], accents[(j + 1) % accents.length], 0.5);

      ctx.clearRect(0, 0, w, h);
      paintDesk(ctx, w, h);
      orbit.forEach((o, n) => {
        const cx = w * (0.15 + o.ax * 0.7) + Math.sin(now * 0.00005 * o.sx + o.ph) * w * 0.12 + px * (1 + n);
        const cy = h * (0.15 + o.ay * 0.7) + Math.cos(now * 0.00004 * o.sy + o.ph) * h * 0.14 + py * (1 + n);
        const rad = Math.max(w, h) * o.r;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        const col = n === 1 ? b : a;
        g.addColorStop(0, rgbCss(col, n === 0 ? 0.09 : 0.06)); // soft, so the desk stays navy and never reads as a colour sweep
        g.addColorStop(1, rgbCss(col, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      });
      // Settles the fields toward the desk at the edges, so text never sits on a bright patch.
      const vig = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.8);
      vig.addColorStop(0, "rgb(17 24 39 / 0)");
      vig.addColorStop(1, "rgb(17 24 39 / 0.55)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);
      // A dark band under the text column on the left, so small type always sits on near-desk colour.
      const scrim = ctx.createLinearGradient(0, 0, w * 0.5, 0);
      scrim.addColorStop(0, "rgb(17 24 39 / 0.62)");
      scrim.addColorStop(1, "rgb(17 24 39 / 0)");
      ctx.fillStyle = scrim;
      ctx.fillRect(0, 0, w * 0.5, h);

      const shift = p * 220;
      const layers: [Motif, number, RGB][] = [[motifs[i], 1 - f, accents[i]]];
      if (j !== i) layers.push([motifs[j], f, accents[j]]);
      for (const [m, alpha, col] of layers) {
        if (alpha <= 0.01) continue;
        // A fresh generator per draw keeps every frame's shapes identical.
        DRAW[m]({ c: ctx, w, h, t: now, a: col, px, py, shift, alpha, rand: rng(base ^ hashSeed(m)) });
      }
    };

    const loop = (t: number) => {
      frame(t);
      raf = requestAnimationFrame(loop);
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
    };
    const onResize = () => {
      size();
      if (reduced) still();
    };
    window.addEventListener("resize", onResize);
    let unsub = () => {};
    if (reduced) {
      still();
      unsub = pos.on("change", still);
    } else {
      window.addEventListener("pointermove", onMove);
      raf = requestAnimationFrame(loop);
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
      <canvas ref={canvas} />
      {icons && (
        <div className="bd-icons">
          {icons.map((set, i) => (
            <IconGroup key={i} index={i} set={set} accent={accents[i]} seed={seed} pos={pos} mx={smx} my={smy} reduced={reduced} />
          ))}
        </div>
      )}
    </div>
  );
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
}: {
  index: number;
  set: LucideIcon[];
  accent: RGB;
  seed: string;
  pos: MotionValue<number>;
  mx: MotionValue<number>;
  my: MotionValue<number>;
  reduced: boolean;
}) {
  const opacity = useTransform(pos, (p) => Math.max(0, 1 - Math.abs(p - index) * 1.7));
  const scroll = useTransform(pos, (p) => (reduced ? 0 : (p - index) * -190));
  const r = rng(hashSeed(`${seed}:icons:${index}`));
  // Three slots around the edges of the screen, away from the headline column and the labels.
  const slots = [
    { x: 40 + r() * 14, y: 7 + r() * 8 },
    { x: 66 + r() * 22, y: 83 + r() * 7 },
    { x: 33 + r() * 14, y: 82 + r() * 8 },
  ];
  return (
    <motion.div className="bd-icons" style={{ opacity }}>
      {set.map((Icon, k) => {
        const depth = 0.6 + r() * 1.2;
        const size = 54 + r() * 40;
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
