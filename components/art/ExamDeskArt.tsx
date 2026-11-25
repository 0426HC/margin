"use client";

import { memo, useEffect, useRef } from "react";
import { useReducedSafe } from "@/components/cinematic/useReducedSafe";
import { Hero, applyPose, type Pose } from "./Hero";
import { box, iso, onTop } from "./iso";
import { useSceneLive } from "./live";
import { Script, easeOut, hop, run, think, useFrameLoop, wait, type Move, type Step } from "./rig";

// The desk: x along its width, y toward the viewer, z up. Its top surface is at TOP.
const DW = 260;
const DD = 150;
const TOP = 122;
const SLAB = 10;
const LEG = 9;

// The exam sheet covers most of the desk top. Its text runs along x.
const SHEET = { x: 24, y: 14, w: 212, h: 122 };
const LINE = { u0: 16, u1: 196, v0: 44, gap: 12, count: 6 };
/** How far along its line each answer is written (a little uneven, like handwriting). */
const WRITE = [0.96, 0.88, 1, 0.82, 0.93, 0.7];
const SCALE = 0.62;
const RUN = 70; // sheet units a second
const SPIN = 0.9; // two full turns of the pencil, easing out
const PAUSE = 0.35;

const lineV = (k: number) => LINE.v0 + k * LINE.gap;
const lineLen = (k: number) => (LINE.u1 - LINE.u0) * WRITE[k];
/** Where the hero stands for a point on the sheet. */
const on = (u: number, v: number) => {
  const [x, y] = iso(SHEET.x + u, SHEET.y + v, TOP + 0.5);
  return { x, y };
};

/** Two lines at most, about 28 characters each; the rest is cut with an ellipsis. */
function wrap(text: string, max = 28): string[] {
  const lines: string[] = [""];
  for (const word of text.split(" ")) {
    const cur = lines[lines.length - 1];
    if (!cur || cur.length + 1 + word.length <= max) lines[lines.length - 1] = cur ? `${cur} ${word}` : word;
    else lines.push(word);
  }
  if (lines.length > 2) return [lines[0], `${lines[1].slice(0, max - 1)}…`];
  return lines;
}

export interface Callout {
  text: string;
}

/**
 * The exam room: a wooden desk with a big exam sheet (a dark title line, a grey line, six faint answer lines). The hero stands on the sheet
 * holding a pencil above its head. It thinks (the pencil spins twice), runs half way along an answer line writing behind it, thinks again,
 * finishes the line, and hops to the next. When every line is written it does a happy double hop, the writing fades, and it starts again.
 * With `blank` it is the empty room: a blank sheet and the hero standing on it, pondering now and then. Still under reduced motion.
 */
export const ExamDeskArt = memo(function ExamDeskArt({ blank = false, callouts = [], label }: { blank?: boolean; callouts?: Callout[]; label: string }) {
  const reduced = useReducedSafe();
  const live = useSceneLive();
  const hero = useRef<SVGGElement>(null);
  const pencil = useRef<SVGGElement>(null);
  const writing = useRef<SVGGElement>(null);
  const lines = useRef<(SVGRectElement | null)[]>([]);
  const script = useRef<Script | null>(null);

  const top = box(0, 0, TOP - SLAB, DW, DD, SLAB);
  const legs = [
    [6, 6],
    [DW - 6 - LEG, 6],
    [6, DD - 6 - LEG],
    [DW - 6 - LEG, DD - 6 - LEG],
  ].map(([x, y]) => box(x, y, 0, LEG, LEG, TOP - SLAB));
  const [shx, shy] = iso(DW / 2, DD / 2, 0);
  const anchors = [18, 52, 86, 120].map((y) => iso(DW, y, TOP));
  const width = callouts.length ? 660 : 420;
  const last = LINE.count - 1;
  const still = blank ? on(SHEET.w * 0.55, SHEET.h * 0.55) : on(LINE.u0 + lineLen(last) + 5, lineV(last));
  const first = on(LINE.u0 - 4, lineV(0));

  useEffect(() => {
    const fill = (k: number, f: number) => {
      const el = lines.current[k];
      if (el) el.style.transform = `scaleX(${Math.max(0, Math.min(1, f)).toFixed(3)})`;
    };
    const spin = (deg: number) => {
      if (pencil.current) pencil.current.style.transform = `rotate(${deg.toFixed(1)}deg)`;
    };
    const rest: Pose = { ...still, lift: 0, tilt: 0, think: 0 };
    if (reduced) {
      script.current = null;
      for (let k = 0; k < LINE.count; k++) fill(k, 1);
      if (writing.current) writing.current.style.opacity = "1";
      spin(0);
      applyPose(hero.current, rest);
      return;
    }
    if (blank) {
      script.current = new Script(rest, () => [wait(5), think(1.3)]);
      applyPose(hero.current, rest);
      return;
    }
    // the pencil spins two full turns with a strong ease-out, then a short pause, while the hero thinks
    const ponder = () => think(SPIN + PAUSE, (_t, secs) => spin(720 * easeOut(Math.min(1, secs / SPIN))));
    const fade: Step = () =>
      ({
        dur: 0.8,
        at: (t: number) => void (writing.current && (writing.current.style.opacity = String(1 - t))),
        end: () => {
          for (let k = 0; k < LINE.count; k++) fill(k, 0);
          if (writing.current) writing.current.style.opacity = "1";
        },
      }) satisfies Move;
    const lineSteps = (k: number): Step[] => {
      const len = lineLen(k);
      const v = lineV(k);
      const start = LINE.u0 - 4;
      const draw = (a: number, b: number) => (t: number) => fill(k, (a + (b - a) * t - LINE.u0) / len);
      const mid = LINE.u0 + len / 2;
      const end = LINE.u0 + len + 5;
      return [
        ...(k > 0 ? [hop(on(start, v), 0.45, 18), wait(0.12)] : []),
        ponder(),
        run(on(mid, v), (mid - start) / RUN, draw(start, mid)),
        ponder(),
        run(on(end, v), (end - mid) / RUN, draw(mid, end)),
        wait(0.2),
      ];
    };
    for (let k = 0; k < LINE.count; k++) fill(k, 0);
    const p0: Pose = { ...first, lift: 0, tilt: 0, think: 0 };
    script.current = new Script(p0, () => [
        ...Array.from({ length: LINE.count }, (_, k) => lineSteps(k)).flat(),
        // every line written: a little happy double hop, the writing fades, and back to the first line
        hop(on(LINE.u0 + lineLen(last) + 5, lineV(last)), 0.28, 16),
        hop(on(LINE.u0 + lineLen(last) + 5, lineV(last)), 0.28, 16),
        fade,
        hop(first, 0.6, 26),
        wait(0.3),
      ]);
    applyPose(hero.current, p0);
    spin(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- still and first are constants for a given `blank`
  }, [reduced, blank]);

  useFrameLoop(live && !reduced, (dt) => script.current && applyPose(hero.current, script.current.tick(dt)));

  return (
    <svg viewBox={`-160 -225 ${width} 450`} className="art-svg art-exam" role="img" aria-label={label}>
      <defs>
        <radialGradient id="art-desk-shadow">
          <stop offset="0" stopColor="#000" stopOpacity="0.42" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx={shx} cy={shy + 8} rx={210} ry={92} fill="url(#art-desk-shadow)" />

      {/* the desk: back legs, the slab, front legs */}
      {legs.map((l, i) => (
        <g key={i}>
          <polygon points={l.front} className="art-wood-front" />
          <polygon points={l.side} className="art-wood-side" />
        </g>
      ))}
      <polygon points={top.front} className="art-wood-front" />
      <polygon points={top.side} className="art-wood-side" />
      <polygon points={top.top} className="art-wood-top" />
      <g transform={onTop(0, 0, TOP)} className="art-grain">
        <path d="M14 22 C70 18 120 26 246 20" />
        <path d="M10 58 C90 62 170 52 250 60" />
        <path d="M18 104 C80 100 150 110 244 102" />
        <path d="M30 132 C110 128 180 136 236 130" />
      </g>

      {/* the exam sheet */}
      <g transform={onTop(SHEET.x, SHEET.y, TOP + 0.5)}>
        <rect x={4} y={4} width={SHEET.w} height={SHEET.h} rx={2} className="art-paper-shadow" />
        <rect x={0} y={0} width={SHEET.w} height={SHEET.h} rx={2} className="art-paper" />
        {!blank && (
          <>
            <rect x={LINE.u0} y={12} width={96} height={4.5} rx={1.4} className="art-paper-title" />
            <rect x={LINE.u0} y={24} width={150} height={2} rx={1} className="art-paper-line" />
            {Array.from({ length: LINE.count }, (_, k) => (
              <rect key={k} x={LINE.u0} y={lineV(k) + 1.4} width={LINE.u1 - LINE.u0} height={0.7} className="art-paper-rule" />
            ))}
            <g ref={writing}>
              {Array.from({ length: LINE.count }, (_, k) => (
                <rect
                  key={k}
                  ref={(el) => void (lines.current[k] = el)}
                  data-answer={k}
                  x={LINE.u0}
                  y={lineV(k) - 1.2}
                  width={lineLen(k)}
                  height={1.9}
                  rx={0.9}
                  className="art-paper-writing"
                />
              ))}
            </g>
          </>
        )}
      </g>

      <Hero heroRef={hero} x={still.x} y={still.y} scale={SCALE}>
        {!blank && (
          // the pencil, held above its head; it spins around its middle while the hero thinks
          <g transform="translate(0 -53)">
            <g ref={pencil} className="hero-pencil">
              <g transform="scale(0.9)">
                <path d="M-21 0 L-15 -2.6 L-15 2.6 Z" className="art-pencil-wood" />
                <path d="M-21 0 L-18.6 -1 L-18.6 1 Z" className="art-pencil-lead" />
                <rect x={-15} y={-2.6} width={27} height={5.2} className="art-pencil" />
                <rect x={-15} y={0.6} width={27} height={2} className="art-pencil-shade" />
                <rect x={12} y={-2.6} width={3.4} height={5.2} className="art-pencil-ferrule" />
                <rect x={15.4} y={-2.6} width={5.6} height={5.2} rx={1.6} className="art-pencil-eraser" />
              </g>
            </g>
          </g>
        )}
      </Hero>

      {callouts.length > 0 && (
        <g className="art-callouts">
          {callouts.slice(0, 4).map((c, i) => {
            const [ax, ay] = anchors[i];
            const ty = -44 + i * 46;
            const tx = 278;
            return (
              <g key={i}>
                <path d={`M${ax} ${ay} L${Math.max(ax + 24, tx - 46)} ${ty} L${tx - 8} ${ty}`} className="art-callout-line" />
                <circle cx={ax} cy={ay} r={2.2} className="art-callout-dot" />
                <text x={tx} y={ty + 4} className="art-callout-text">
                  {wrap(c.text).map((line, k) => (
                    <tspan key={k} x={tx} dy={k ? 16 : 0}>
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}
        </g>
      )}
    </svg>
  );
});
