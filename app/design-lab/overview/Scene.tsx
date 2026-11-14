"use client";

import { cubicBezier, motion, useScroll, useTransform, type MotionValue } from "motion/react";
import { useRef, type RefObject } from "react";
import { MasteryMark } from "../MasteryMark";
import type { SectionMeta, Status, UnitMeta } from "../data";
import { ENTER, ROT_X, ROT_Z, SCENE_VH, diagram, sheetTiming, type Viewport } from "@/components/cinematic/geometry";

const settle = cubicBezier(0.23, 1, 0.32, 1);
const glide = cubicBezier(0.65, 0, 0.35, 1);

export type OpenSection = (section: SectionMeta, sheet: HTMLElement | null, size: { W: number; H: number }) => void;

/** Sorted so the bar reads as a tally: solid, then shaky, then new. */
const ORDER: Status[] = ["solid", "shaky", "new"];
const NAMES = { solid: "solid", shaky: "shaky", new: "new" } as const;

export function tally(sections: SectionMeta[]) {
  return ORDER.map((status) => ({ status, count: sections.filter((s) => s.status === status).length }));
}

/** Ink reveal: each word darkens into the page as you scroll past its place in the sentence. */
function InkWord({ word, p, at, span }: { word: string; p: MotionValue<number>; at: number; span: number }) {
  const opacity = useTransform(p, [at, at + span], [0.07, 1]);
  return <motion.span style={{ opacity }}>{word} </motion.span>;
}

function Cell({ status, title, p, range }: { status: Status; title: string; p: MotionValue<number>; range: [number, number] }) {
  const scaleX = useTransform(p, range, [0, 1], { ease: settle });
  return <motion.i className="ov-cell" data-status={status} title={title} style={{ scaleX }} />;
}

/** One sheet of the exploded stack. Its z is the only thing that moves. */
function Sheet({
  section,
  i,
  n,
  p,
  d,
  hidden,
  onOpen,
  sheetRefs,
}: {
  section: SectionMeta;
  i: number;
  n: number;
  p: MotionValue<number>;
  d: ReturnType<typeof diagram>;
  hidden: boolean;
  onOpen: OpenSection;
  sheetRefs: RefObject<Record<string, HTMLElement | null>>;
}) {
  const t = sheetTiming(i, n);
  const z = useTransform(p, [t.a, t.b], [d.stackZ(i), d.liftZ(i)], { ease: glide });
  return (
    <motion.div className="ov-sheet-slot" style={{ z, width: d.W, height: d.H, marginLeft: -d.W / 2, marginTop: -d.H / 2 }}>
      <div
        className="ov-sheet"
        aria-hidden="true"
        ref={(el) => {
          sheetRefs.current[section.id] = el;
        }}
        style={{ visibility: hidden ? "hidden" : "visible" }}
        onClick={() => onOpen(section, sheetRefs.current[section.id], { W: d.W, H: d.H })}
      >
        <SheetPrint title={section.title} status={section.status} />
      </div>
    </motion.div>
  );
}

export function SheetPrint({ title, status }: { title: string; status: Status }) {
  return (
    <>
      <span className="ov-sheet-tab" data-status={status} />
      <strong>{title}</strong>
      <span className="ov-sheet-lines" />
    </>
  );
}

function Leader({ i, n, p, d }: { i: number; n: number; p: MotionValue<number>; d: ReturnType<typeof diagram> }) {
  const t = sheetTiming(i, n);
  const pathLength = useTransform(p, [t.lineA, t.lineB], [0, 1]);
  const dot = useTransform(p, [t.lineA, t.lineA + 0.01], [0, 1]);
  const y = d.rowY(i) + d.cornerY;
  const x1 = d.cx + d.halfW;
  return (
    <>
      <motion.circle className="ov-leader-dot" cx={x1} cy={y} r={2.5} style={{ opacity: dot }} />
      <motion.path className="ov-leader" d={`M${x1},${y} L${d.labelX - 8},${y}`} style={{ pathLength, opacity: dot }} />
    </>
  );
}

function Label({
  section,
  i,
  n,
  p,
  d,
  onOpen,
  sheetRefs,
  onFocusLate,
}: {
  section: SectionMeta;
  i: number;
  n: number;
  p: MotionValue<number>;
  d: ReturnType<typeof diagram>;
  onOpen: OpenSection;
  sheetRefs: RefObject<Record<string, HTMLElement | null>>;
  onFocusLate: () => void;
}) {
  const t = sheetTiming(i, n);
  const opacity = useTransform(p, [t.labelA, t.labelB], [0, 1]);
  const x = useTransform(p, [t.labelA, t.labelB], [-8, 0], { ease: settle });
  const pointerEvents = useTransform(opacity, (o) => (o > 0.5 ? "auto" : "none"));
  return (
    <motion.button
      type="button"
      className="ov-label"
      style={{ opacity, x, pointerEvents, left: d.labelX, top: d.rowY(i) + d.cornerY - 11, width: d.labelW }}
      onFocus={onFocusLate}
      onClick={() => onOpen(section, sheetRefs.current[section.id], { W: d.W, H: d.H })}
    >
      <span className="ov-label-title">
        <MasteryMark status={section.status} />
        {section.title}
      </span>
      <span className="ov-label-focus">{section.focus}</span>
    </motion.button>
  );
}

export function Scene({
  unit,
  vp,
  flyingId,
  onOpen,
  sceneRef,
  scrollToEnd,
}: {
  unit: UnitMeta;
  vp: Viewport;
  flyingId: string | null;
  onOpen: OpenSection;
  sceneRef: (el: HTMLElement | null) => void;
  scrollToEnd: (el: HTMLElement) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const sheetRefs = useRef<Record<string, HTMLElement | null>>({});
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start end", "end end"] });
  const n = unit.sections.length;
  const d = diagram(vp, n);

  // Headline push-in: arrives oversized and centred, then settles to the top of its column.
  const left = Math.max(72, vp.w * 0.064);
  const colW = Math.max(300, d.cx - d.halfW - left - 40);
  const fs = Math.max(44, Math.min(72, vp.w * 0.05));
  const big = Math.min(2.05, (vp.w - 2 * left) / colW);
  const lines = unit.name.length > colW / (fs * 0.5) ? 2 : 1;
  const top = Math.max(96, vp.h * 0.15);
  const x0 = (vp.w - colW * big) / 2 - left;
  const y0 = (vp.h - fs * 1.04 * lines * big) / 2 - top - 24;
  const settleEnd = ENTER + 0.12;
  const scale = useTransform(p, [0, ENTER, settleEnd], [2.75, big, 1], { ease: [settle, glide] });
  const x = useTransform(p, [ENTER, settleEnd], [x0, 0], { ease: glide });
  const y = useTransform(p, [0, ENTER, settleEnd], [y0 + 70, y0, 0], { ease: [settle, glide] });
  const titleOpacity = useTransform(p, [0.02, ENTER * 0.8], [0, 1]);

  const kicker = useTransform(p, [settleEnd - 0.04, settleEnd], [0, 1]);

  const words = unit.why.split(" ");
  const inkStart = ENTER + 0.1;
  const inkSpan = 0.2;

  const statA = ENTER + 0.27;
  const statText = useTransform(p, [statA + 0.04, statA + 0.1], [0, 1]);

  const stackOpacity = useTransform(p, [ENTER + 0.11, ENTER + 0.17], [0, 1]);
  const stackRise = useTransform(p, [ENTER + 0.11, ENTER + 0.19], [18, 0], { ease: settle });
  const axis = useTransform(p, [ENTER + 0.17, ENTER + 0.46], [0, 1]);

  const counts = tally(unit.sections);
  const ordered = ORDER.flatMap((status) => unit.sections.filter((s) => s.status === status));

  // Keyboard users tab to a label: bring its scene to the point where the labels show.
  const onFocusLate = () => {
    if (ref.current && p.get() < 0.9) scrollToEnd(ref.current);
  };

  return (
    <section
      className="ov-scene"
      aria-labelledby={`ov-h-${unit.id}`}
      style={{ height: `${SCENE_VH}vh` }}
      ref={(el) => {
        ref.current = el;
        sceneRef(el);
      }}
    >
      <div className="ov-stage">
        <div className="ov-col" style={{ left, top, width: colW }}>
          <motion.p className="ov-kicker" style={{ opacity: kicker }}>
            {unit.label}
          </motion.p>
          <motion.h2
            id={`ov-h-${unit.id}`}
            className="ov-title"
            style={{ fontSize: fs, scale, x, y, opacity: titleOpacity, transformOrigin: "0 0" }}
          >
            {unit.name}
          </motion.h2>
          <motion.div className="ov-ink" style={{ opacity: kicker }}>
            <h3>Why this unit matters</h3>
            <p aria-label={unit.why}>
              {words.map((w, i) => (
                <InkWord key={i} word={w} p={p} at={inkStart + (i / words.length) * inkSpan} span={0.035} />
              ))}
            </p>
          </motion.div>
          <div className="ov-stat">
            <div className="ov-bar" role="img" aria-label={counts.map((c) => `${c.count} ${NAMES[c.status]}`).join(", ")}>
              {ordered.map((s, i) => (
                <Cell
                  key={s.id}
                  status={s.status}
                  title={`${s.title}: ${NAMES[s.status]}`}
                  p={p}
                  range={[statA + i * 0.012, statA + 0.05 + i * 0.012]}
                />
              ))}
            </div>
            <motion.p className="ov-counts" style={{ opacity: statText }}>
              {counts.map((c) => (
                <span key={c.status}>
                  <MasteryMark status={c.status} />
                  <b>{c.count}</b> {NAMES[c.status]}
                </span>
              ))}
            </motion.p>
          </div>
        </div>

        <svg className="ov-diagram" width={vp.w} height={vp.h} aria-hidden="true">
          {n > 1 && (
            <motion.path
              className="ov-axis"
              d={`M${d.cx},${d.rowY(0)} L${d.cx},${d.rowY(n - 1)}`}
              style={{ pathLength: axis, opacity: stackOpacity }}
            />
          )}
          {unit.sections.map((s, i) => (
            <Leader key={s.id} i={i} n={n} p={p} d={d} />
          ))}
        </svg>

        <motion.div className="ov-iso-wrap" style={{ left: d.cx, top: d.cy, opacity: stackOpacity, y: stackRise }}>
          <div className="ov-iso" style={{ transform: `rotateX(${ROT_X}deg) rotateZ(${ROT_Z}deg)` }}>
            {unit.sections.map((s, i) => (
              <Sheet key={s.id} section={s} i={i} n={n} p={p} d={d} hidden={flyingId === s.id} onOpen={onOpen} sheetRefs={sheetRefs} />
            ))}
          </div>
        </motion.div>

        {unit.sections.map((s, i) => (
          <Label key={s.id} section={s} i={i} n={n} p={p} d={d} onOpen={onOpen} sheetRefs={sheetRefs} onFocusLate={onFocusLate} />
        ))}
      </div>
    </section>
  );
}

/** Reduced motion: the same content as a plain page, with simple fades and nothing scroll-linked. */
export function FlatScene({ unit, sceneRef, onOpen }: { unit: UnitMeta; sceneRef: (el: HTMLElement | null) => void; onOpen: OpenSection }) {
  const counts = tally(unit.sections);
  return (
    <motion.section
      className="ov-flat"
      aria-labelledby={`ov-h-${unit.id}`}
      ref={sceneRef}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.3 }}
    >
      <p className="ov-kicker">{unit.label}</p>
      <h2 id={`ov-h-${unit.id}`} className="ov-title">
        {unit.name}
      </h2>
      <p className="ov-flat-why">{unit.why}</p>
      <p className="ov-counts">
        {counts.map((c) => (
          <span key={c.status}>
            <MasteryMark status={c.status} />
            <b>{c.count}</b> {NAMES[c.status]}
          </span>
        ))}
      </p>
      <ul>
        {unit.sections.map((s) => (
          <li key={s.id}>
            <button type="button" className="ov-label static" onClick={() => onOpen(s, null, { W: 0, H: 0 })}>
              <span className="ov-label-title">
                <MasteryMark status={s.status} />
                {s.title}
              </span>
              <span className="ov-label-focus">{s.focus}</span>
            </button>
          </li>
        ))}
      </ul>
    </motion.section>
  );
}
