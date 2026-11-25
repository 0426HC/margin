"use client";

import { useRouter } from "next/navigation";
import { memo, useEffect, useRef, useState } from "react";
import { useReducedSafe } from "@/components/cinematic/useReducedSafe";
import type { WeekSummary } from "@/lib/weeks/notes";
import { Hero, applyPose } from "./Hero";
import { iso, pts } from "./iso";
import { arc } from "./rig";
import { keyStep, labelAt, wheelPixels, wheelStep, type WeekLabel } from "./weekPick";

const D = 64; // a sheet's width (along x)
const H = 92; // and height
const TK = 1.6; // its thickness
const TAB = { w: 15, h: 8 };
const GAP = 21; // between two sheets, along y
const HERO_X = 44; // where the hero stands along a sheet's top edge (the tabs sit to its left)
const HOP = 18; // hop height, in hero units
const SCALE = 0.42;

/**
 * Lecture notes: one thin white sheet standing in a row for each week of the course, week 1 at the front (bottom left) and the last week at
 * the back. Weeks with notes have a plum tab. The hero stands on the top edge of the selected week. Over the sheets, the wheel moves the hero
 * instead of the page (one sheet per 110 px, hopping in an arc between sheets, staying in the air if you stop halfway), until the first or
 * last week, where the page scrolls on. The big week number rolls with it like an odometer. Click a sheet, or use the arrow keys (instant) and Enter.
 */
export const WeeksArt = memo(function WeeksArt({ weeks, current, projectId }: { weeks: WeekSummary[]; current: number; projectId: string }) {
  const router = useRouter();
  const reduced = useReducedSafe();
  const n = Math.max(weeks.length, 1);
  const start = Math.max(0, weeks.findIndex((w) => w.week === current));
  const pos = useRef(start);
  const hero = useRef<SVGGElement>(null);
  const roll = useRef<HTMLSpanElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const [label, setLabel] = useState<WeekLabel>({ kind: "on", index: start });
  const near = label.kind === "on" ? label.index : Math.round(pos.current);

  // the frame fits at least five weeks, so a short course's sheets still stand large; a longer course widens it
  const span = Math.max(n - 1, 4) * GAP;
  const y0 = (span - (n - 1) * GAP) / 2;
  const yOf = (p: number) => y0 + (n - 1 - p) * GAP;
  const [sx, sy] = iso(D / 2, span / 2, 0);
  const minX = -span * 0.87 - 24;
  const maxX = D * 0.87 + 24;
  const minY = -H - TAB.h - 34;
  const maxY = (span + D) * 0.5 + 34;

  /** Draws everything that follows the hero's place: the hero (with its hop), the rolling number, the labels. */
  const show = (p: number) => {
    const shown = reduced ? Math.round(p) : p;
    const [x, y] = iso(HERO_X, yOf(shown), H);
    const f = shown - Math.floor(shown);
    applyPose(hero.current, { x, y, lift: reduced ? 0 : arc(f, HOP), tilt: 0, think: 0 });
    if (roll.current) roll.current.style.transform = `translateY(${(-shown * 100) / n}%)`;
    const next = labelAt(shown);
    setLabel((l) => (l.kind === next.kind && (l.kind === "on" ? l.index === (next as typeof l).index : l.a === (next as typeof l).a) ? l : next));
  };
  const showRef = useRef(show);
  useEffect(() => {
    showRef.current = show;
  });
  useEffect(() => showRef.current(pos.current), [reduced]);

  // The wheel over the sheets moves the hero, not the page, until the first or last week. Native listener: it has to be able to say no.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch to zoom
      const dy = wheelPixels(e, window.innerHeight);
      if (Math.abs(e.deltaX) > Math.abs(dy)) return;
      const step = wheelStep(pos.current, dy, n);
      if (!step.capture) return;
      e.preventDefault();
      e.stopPropagation(); // Lenis listens on the window
      pos.current = step.pos;
      showRef.current(step.pos);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [n]);

  /** Keyboard: straight to the next sheet. Keyboard actions don't animate: they repeat, and motion would only make them feel slow. */
  const goTo = (target: number) => {
    pos.current = target;
    show(target);
  };
  const open = (i: number) => router.push(`/p/${projectId}/lecture-notes/${weeks[i]?.week ?? 1}`);
  const at = weeks[label.kind === "on" ? label.index : near];

  const [hx, hy] = iso(HERO_X, yOf(start), H);
  return (
    <div className="art-weeks">
      <div
        ref={area}
        className="art-weeks-sheets"
        tabIndex={0}
        role="slider"
        aria-label="Pick a week. Arrow keys move one week, Enter opens it."
        aria-valuemin={1}
        aria-valuemax={n}
        aria-valuenow={at?.week ?? 1}
        aria-valuetext={label.kind === "on" ? `Week ${at?.week} of ${n}, ${at?.hasNotes ? "has notes" : "no notes yet"}` : `Between week ${weeks[label.a]?.week} and ${weeks[label.b]?.week}`}
        onKeyDown={(e) => {
          const from = pos.current;
          if (e.key === "ArrowLeft" || e.key === "ArrowUp") goTo(keyStep(from, -1, n));
          else if (e.key === "ArrowRight" || e.key === "ArrowDown") goTo(keyStep(from, 1, n));
          else if (e.key === "Enter") open(Math.round(from));
          else return;
          e.preventDefault();
        }}
        onClick={(e) => {
          const w = (e.target as Element).closest("[data-week]")?.getAttribute("data-week");
          if (w !== null && w !== undefined) open(Number(w));
        }}
      >
        <svg viewBox={`${minX.toFixed(0)} ${minY.toFixed(0)} ${(maxX - minX).toFixed(0)} ${(maxY - minY).toFixed(0)}`} className="art-svg" aria-hidden="true">
          <defs>
            <radialGradient id="art-weeks-shadow">
              <stop offset="0" stopColor="#000" stopOpacity="0.45" />
              <stop offset="1" stopColor="#000" stopOpacity="0" />
            </radialGradient>
          </defs>
          <ellipse cx={sx} cy={sy + 6} rx={70 + (n - 1) * GAP * 0.75} ry={30 + (n - 1) * GAP * 0.3} fill="url(#art-weeks-shadow)" />
          {/* back to front: the last week first, week 1 last (it stands in front) */}
          {weeks
            .map((w, i) => ({ w, i }))
            .reverse()
            .map(({ w, i }) => {
              const y = yOf(i);
              const isNear = i === near;
              const t = 5 + (i % 3) * 5;
              return (
                <g key={w.week} className="art-week" data-week={i} data-near={isNear ? "" : undefined} data-notes={w.hasNotes ? "" : undefined}>
                  <polygon className="art-week-edge" points={pts([D, y - TK, 0], [D, y, 0], [D, y, H], [D, y - TK, H])} />
                  <polygon className="art-week-face" points={pts([0, y, 0], [D, y, 0], [D, y, H], [0, y, H])} />
                  <polygon className="art-week-top" points={pts([0, y - TK, H], [D, y - TK, H], [D, y, H], [0, y, H])} />
                  {w.hasNotes && <polygon className="art-week-tab" data-near={isNear ? "" : undefined} points={pts([t, y, H], [t + TAB.w, y, H], [t + TAB.w - 2, y, H + TAB.h], [t + 2, y, H + TAB.h])} />}
                </g>
              );
            })}
          <Hero heroRef={hero} x={hx} y={hy} scale={SCALE} />
        </svg>
      </div>
      <div className="art-weeks-now">
        <span className="art-weeks-num" aria-hidden="true">
          <span className="art-weeks-roll" ref={roll} style={{ transform: `translateY(${(-start * 100) / n}%)` }}>
            {weeks.map((w) => (
              <span key={w.week}>{w.week}</span>
            ))}
          </span>
        </span>
        {label.kind === "on" ? (
          <>
            <span className="art-weeks-when">
              WEEK {at?.week} OF {n}
            </span>
            {at?.hasNotes ? <span className="art-weeks-has">● Has notes</span> : <span className="art-weeks-none">No notes yet</span>}
          </>
        ) : (
          <>
            <span className="art-weeks-when">
              BETWEEN WEEK {weeks[label.a]?.week} AND {weeks[label.b]?.week}
            </span>
            <span className="art-weeks-none" aria-hidden="true">
              &nbsp;
            </span>
          </>
        )}
        <span className="art-weeks-hint">Scroll on the sheets to pick a week · Click to open it</span>
      </div>
    </div>
  );
});
