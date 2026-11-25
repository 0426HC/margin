"use client";

/* eslint-disable react-hooks/immutability -- sheet elements are collected into a ref map for the zoom, a pattern the compiler rule does not know */

import { ReadMark } from "./ReadMark";
import { useRef, type CSSProperties, type RefObject } from "react";
import { LayerMark } from "@/components/ui/LayerMark";
import { useRevealOnce } from "@/components/cinematic/useRevealOnce";
import { ENTER, ROT_X, ROT_Z, SCENE_VH, diagram, focusLines, scrollRange, sheetTiming, type Viewport } from "@/components/cinematic/geometry";
import type { LayerState } from "@/lib/layers/progress";

/** What a scene needs from a layer. */
export type SceneLayer = { id: string; title: string; focus: string; state: LayerState; /** Something was written back or asked in this layer (saved or not). */ started?: boolean; /** Printed on the sheet instead of ruled lines (Note to Self: my final writing). */ excerpt?: string };
/** One scene: a week of the course, with its layers as the sheets of the teardown. `label` is the kicker ("Week 3 of 11"), `name` the heading. */
/** `read`: the course brain has read every file of this week (a small mark beside its label). */
export type SceneWeek = { id: string; week?: number; label: string; name: string; why: string; layers: SceneLayer[]; read?: boolean };

/** Two buckets so the tally reads: saved to Note to Self, or not saved. */
type Bucket = "saved" | "open";
export const bucketOf = (s: LayerState): Bucket => (s === "saved" ? "saved" : "open");
const CSS_STATUS: Record<Bucket, string> = { saved: "solid", open: "new" };
const STATE_OF: Record<Bucket, LayerState> = { saved: "saved", open: "not_saved" };

export type OpenSection = (section: SceneLayer, sheet: HTMLElement | null, size: { W: number; H: number }) => void;

/** The one button of a week's scene: start, continue or revisit it, at its first layer not yet saved. */
export function weekAction(unit: SceneWeek): { label: string; layer: SceneLayer } | null {
  const next = unit.layers.find((l) => l.state !== "saved");
  const layer = next ?? unit.layers[0];
  if (!layer) return null;
  const saved = unit.layers.filter((l) => l.state === "saved").length;
  const what = unit.week ? `week ${unit.week}` : unit.name;
  return { layer, label: !next ? `Revisit ${what}` : saved === 0 ? `Start ${what}` : `Continue ${what}` };
}

/** Sorted so the bar reads as a tally: saved, then not saved. */
const ORDER: Bucket[] = ["saved", "open"];
const NAMES = { saved: "saved", open: "not saved" } as const;

export function tally(layers: SceneLayer[]) {
  return ORDER.map((status) => ({ status, count: layers.filter((s) => bucketOf(s.state) === status).length }));
}

/*
 * Every moving part of a scene is a CSS animation on the scene's own view timeline (overview.css): the browser plays it from the scroll
 * position on its compositor thread, in step with the scroll itself. Scripts only lay the scene out; nothing runs per frame. Each part
 * says when it moves as a stretch of the scene's progress p (0 when the scene's top enters the window, 1 when its bottom reaches the
 * window's bottom), turned into an animation range by `scrollRange`.
 */
const range = (...spans: [number, number][]) => spans.map(([a, b]) => scrollRange(a, b)).join(", ");

/**
 * A label or button still fading in is not there yet: a click on it does nothing until it is more than half visible, as before. Read from
 * its live opacity at the click, so no animation of pointer-events has to run on the page's own thread on every frame.
 */
const shown = (el: HTMLElement) => Number(getComputedStyle(el).opacity) > 0.5;

/** One sheet of the exploded stack. Its z is the only thing that moves. */
function Sheet({
  section,
  i,
  n,
  d,
  hidden,
  onOpen,
  sheetRefs,
}: {
  section: SceneLayer;
  i: number;
  n: number;
  d: ReturnType<typeof diagram>;
  hidden: boolean;
  onOpen: OpenSection;
  sheetRefs: RefObject<Record<string, HTMLElement | null>>;
}) {
  const t = sheetTiming(i, n);
  return (
    <div
      className="ov-sheet-slot"
      style={{ width: d.W, height: d.H, marginLeft: -d.W / 2, marginTop: -d.H / 2, ["--z0" as string]: `${d.stackZ(i)}px`, ["--z1" as string]: `${d.liftZ(i)}px`, animationRange: range([t.a, t.b]) }}
    >
      <div
        className="ov-sheet"
        aria-hidden="true"
        ref={(el) => {
          sheetRefs.current[section.id] = el;
        }}
        style={{ visibility: hidden ? "hidden" : "visible" }}
        onClick={() => onOpen(section, sheetRefs.current[section.id], { W: d.W, H: d.H })}
      >
        <SheetPrint title={section.title} state={section.state} excerpt={section.excerpt} />
      </div>
    </div>
  );
}

export function SheetPrint({ title, state, excerpt }: { title: string; state: LayerState; excerpt?: string }) {
  return (
    <>
      <span className="ov-sheet-tab" data-status={CSS_STATUS[bucketOf(state)]} />
      <strong>{title}</strong>
      {excerpt ? <span className="ov-sheet-text">{excerpt}</span> : <span className="ov-sheet-lines" />}
    </>
  );
}

/** The line from a sheet's corner to its label, drawn out from the sheet, and the dot it starts from. */
function Leader({ i, n, d }: { i: number; n: number; d: ReturnType<typeof diagram> }) {
  const t = sheetTiming(i, n);
  const y = d.rowY(i) + d.cornerY;
  const x1 = d.cx + d.halfW;
  const dot: [number, number] = [t.lineA, t.lineA + 0.01];
  return (
    <>
      <i className="ov-leader" style={{ left: x1, top: y - 0.5, width: d.labelX - 8 - x1, animationRange: range([t.lineA, t.lineB], dot) }} />
      <i className="ov-leader-dot" style={{ left: x1 - 2.5, top: y - 2.5, animationRange: range(dot) }} />
    </>
  );
}

function Label({
  section,
  i,
  n,
  d,
  onOpen,
  sheetRefs,
  onFocusLate,
}: {
  section: SceneLayer;
  i: number;
  n: number;
  d: ReturnType<typeof diagram>;
  onOpen: OpenSection;
  sheetRefs: RefObject<Record<string, HTMLElement | null>>;
  onFocusLate: () => void;
}) {
  const t = sheetTiming(i, n);
  const fade: [number, number] = [t.labelA, t.labelB];
  return (
    <button
      type="button"
      className="ov-label ov-label-in"
      style={{ left: d.labelX, top: d.rowY(i) + d.cornerY - 11, width: d.labelW, ["--focus-lines" as string]: focusLines(d.step), animationRange: range(fade, fade) }}
      onFocus={onFocusLate}
      onClick={(e) => shown(e.currentTarget) && onOpen(section, sheetRefs.current[section.id], { W: d.W, H: d.H })}
    >
      <span className="ov-label-title" title={section.title}>
        <LayerMark state={section.state} />
        <span className="ov-label-text">{section.title}</span>
      </span>
      <span className="ov-label-focus">{section.focus}</span>
    </button>
  );
}

export function Scene({
  unit,
  vp,
  topMin = 96,
  flyingId,
  onOpen,
  sceneRef,
  scrollToEnd,
  inkHeading = "What this week covers",
  counted,
}: {
  unit: SceneWeek;
  /** The space the scene is laid out in: the window below the course's header. */
  vp: Viewport;
  /** The least room above the headline column, inside the stage. */
  topMin?: number;
  flyingId: string | null;
  onOpen: OpenSection;
  sceneRef: (el: HTMLElement | null) => void;
  scrollToEnd: (el: HTMLElement) => void;
  /** The small heading over the ink reveal. */
  inkHeading?: string;
  /** The sheets the tally counts, when not all of them (Note to Self leaves the synthesis out). */
  counted?: SceneLayer[];
}) {
  const ref = useRef<HTMLElement>(null);
  const sheetRefs = useRef<Record<string, HTMLElement | null>>({});
  const n = unit.layers.length;
  const d = diagram(vp, n);

  // Headline push-in: arrives oversized and centred, then settles to the top of its column.
  const left = Math.max(72, vp.w * 0.064);
  const colW = Math.max(300, d.cx - d.halfW - left - 40);
  // a week's title from the syllabus can be long ("Week 1 · Why a new government? Federalist No. 1"): the headline shrinks to stay
  // within two lines, so the column under it (what the week covers, the tally, its button) still fits the window
  const CHAR = 0.56; // the display face's average character width, in ems
  const fs = Math.max(30, Math.min(Math.max(44, Math.min(72, vp.w * 0.05)), (2 * colW) / (unit.name.length * CHAR)));
  const big = Math.min(2.05, (vp.w - 2 * left) / colW);
  const lines = unit.name.length > colW / (fs * CHAR) ? 2 : 1;
  const top = Math.max(topMin, vp.h * 0.15);
  const x0 = (vp.w - colW * big) / 2 - left;
  const y0 = (vp.h - fs * 1.04 * lines * big) / 2 - top - 24;
  const settleEnd = ENTER + 0.12;
  const kicker = range([settleEnd - 0.04, settleEnd]);

  const words = unit.why.split(" ");
  const inkStart = ENTER + 0.1;
  const inkSpan = 0.2;

  const statA = ENTER + 0.27;
  const statText = range([statA + 0.04, statA + 0.1]);

  const stackIn: [number, number] = [ENTER + 0.11, ENTER + 0.17];

  const action = weekAction(unit);
  const tallied = counted ?? unit.layers;
  const counts = tally(tallied);
  const ordered = ORDER.flatMap((status) => tallied.filter((s) => bucketOf(s.state) === status));

  // Keyboard users tab to a label: bring its scene to the point where the labels show.
  const onFocusLate = () => {
    const el = ref.current;
    if (!el) return;
    const p = (window.innerHeight - el.getBoundingClientRect().top) / el.offsetHeight;
    if (p < 0.9) scrollToEnd(el);
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
          <p className="ov-kicker ov-fade" style={{ animationRange: kicker }}>
            {unit.label}
            {unit.read && <ReadMark />}
          </p>
          <h2
            id={`ov-h-${unit.id}`}
            className="ov-title ov-title-in"
            style={{ fontSize: fs, transformOrigin: "0 0", ["--x0" as string]: `${x0}px`, ["--y0" as string]: `${y0}px`, ["--big" as string]: big, animationRange: range([0, settleEnd], [0.02, ENTER * 0.8]) } as CSSProperties}
          >
            {unit.name}
          </h2>
          <div className="ov-ink ov-fade" style={{ animationRange: kicker }}>
            <h3>{inkHeading}</h3>
            <p aria-label={unit.why}>
              {words.map((w, i) => {
                const at = inkStart + (i / words.length) * inkSpan;
                return (
                  <span key={i} className="ov-ink-w" style={{ animationRange: range([at, at + 0.035]) }}>
                    {w}{" "}
                  </span>
                );
              })}
            </p>
          </div>
          <div className="ov-stat">
            <div className="ov-bar" role="img" aria-label={counts.map((c) => `${c.count} ${NAMES[c.status]}`).join(", ")}>
              {ordered.map((s, i) => (
                <i
                  key={s.id}
                  className="ov-cell ov-cell-in"
                  data-status={CSS_STATUS[bucketOf(s.state)]}
                  title={`${s.title}: ${NAMES[bucketOf(s.state)]}`}
                  style={{ animationRange: range([statA + i * 0.012, statA + 0.05 + i * 0.012]) }}
                />
              ))}
            </div>
            <p className="ov-counts ov-fade" style={{ animationRange: statText }}>
              {counts.map((c) => (
                <span key={c.status}>
                  <LayerMark state={STATE_OF[c.status]} />
                  <b>{c.count}</b> {NAMES[c.status]}
                </span>
              ))}
            </p>
          </div>
          {action && (
            <button type="button" className="ov-end-primary ov-part-go ov-fade" style={{ animationRange: statText }} onFocus={onFocusLate} onClick={(e) => shown(e.currentTarget) && onOpen(action.layer, sheetRefs.current[action.layer.id], { W: d.W, H: d.H })}>
              {action.label}
            </button>
          )}
        </div>

        <div className="ov-diagram" aria-hidden="true">
          {n > 1 && <i className="ov-axis" style={{ left: d.cx - 0.5, top: d.rowY(0), height: d.rowY(n - 1) - d.rowY(0), animationRange: range(stackIn) }} />}
          {unit.layers.map((s, i) => (
            <Leader key={s.id} i={i} n={n} d={d} />
          ))}
        </div>

        <div className="ov-iso-wrap ov-stack-in" style={{ left: d.cx, top: d.cy, animationRange: range(stackIn, [ENTER + 0.11, ENTER + 0.19]) }}>
          <div className="ov-iso" style={{ transform: `rotateX(${ROT_X}deg) rotateZ(${ROT_Z}deg)` }}>
            {unit.layers.map((s, i) => (
              <Sheet key={s.id} section={s} i={i} n={n} d={d} hidden={flyingId === s.id} onOpen={onOpen} sheetRefs={sheetRefs} />
            ))}
          </div>
        </div>

        {unit.layers.map((s, i) => (
          <Label key={s.id} section={s} i={i} n={n} d={d} onOpen={onOpen} sheetRefs={sheetRefs} onFocusLate={onFocusLate} />
        ))}
      </div>
    </section>
  );
}

/** Reduced motion, and the page as sent before scripts run: the same content as a plain page, with a simple fade and nothing scroll-linked. */
export function FlatScene({ unit, sceneRef, onOpen }: { unit: SceneWeek; sceneRef: (el: HTMLElement | null) => void; onOpen: OpenSection }) {
  const counts = tally(unit.layers);
  const action = weekAction(unit);
  const ref = useRef<HTMLElement | null>(null);
  // visible as sent; faded in on first view only once scripts run (and only if it is below the fold)
  const reveal = useRevealOnce(ref, 0.2);
  return (
    <section
      className="ov-flat"
      aria-labelledby={`ov-h-${unit.id}`}
      data-reveal={reveal === "static" ? undefined : reveal}
      ref={(el) => {
        ref.current = el;
        sceneRef(el);
      }}
    >
      <p className="ov-kicker">
        {unit.label}
        {unit.read && <ReadMark />}
      </p>
      <h2 id={`ov-h-${unit.id}`} className="ov-title">
        {unit.name}
      </h2>
      <p className="ov-flat-why">{unit.why}</p>
      <p className="ov-counts">
        {counts.map((c) => (
          <span key={c.status}>
            <LayerMark state={STATE_OF[c.status]} />
            <b>{c.count}</b> {NAMES[c.status]}
          </span>
        ))}
      </p>
      <ul>
        {unit.layers.map((s) => (
          <li key={s.id}>
            <button type="button" className="ov-label static" onClick={() => onOpen(s, null, { W: 0, H: 0 })}>
              <span className="ov-label-title">
                <LayerMark state={s.state} />
                {s.title}
              </span>
              <span className="ov-label-focus">{s.focus}</span>
            </button>
          </li>
        ))}
      </ul>
      {action && (
        <button type="button" className="ov-end-primary ov-part-go" onClick={() => onOpen(action.layer, null, { W: 0, H: 0 })}>
          {action.label}
        </button>
      )}
    </section>
  );
}
