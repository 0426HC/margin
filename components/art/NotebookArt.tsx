"use client";

import { memo, useLayoutEffect, useRef } from "react";
import { useReducedSafe } from "@/components/cinematic/useReducedSafe";
import { Hero, applyPose } from "./Hero";
import { box, iso, onTop } from "./iso";
import { useSceneLive } from "./live";
import { MARGIN_U, PAGE, linesPlan, notebookRows, readSeen, writeSeen, type Row } from "./notebookLines";
import { Script, call, hop, run, think, useFrameLoop, wait, type Step } from "./rig";

const { w: PW, h: PH } = PAGE;
const Z = 10; // the page surface
const SCALE = 0.5; // the hero is small next to the notebook
const RUN = 46; // page units a second

/** Where the hero stands for a point on the page. */
const at = (u: number, v: number) => {
  const [x, y] = iso(u, v, Z);
  return { x, y };
};

/**
 * Note to Self: the big open notebook (two pages, a dark-blue cover), a plum margin line down the left page and faint ruled lines, one per
 * layer of the course. Each layer saved is one written grey line. The hero writes the lines this student hasn't seen yet: it hops to the
 * margin, runs along the line while it draws itself behind it, stops halfway to ponder, then finishes. Then it sits beside the last line
 * and ponders now and then. Lines seen before (remembered per project in this browser) are drawn at once. Still under reduced motion.
 */
export const NotebookArt = memo(function NotebookArt({ saved, total, projectId }: { saved: number; total: number; projectId: string }) {
  const reduced = useReducedSafe();
  const live = useSceneLive();
  const { rows } = notebookRows(Math.max(total, saved));
  const lines = useRef<(SVGRectElement | null)[]>([]);
  const hero = useRef<SVGGElement>(null);
  const script = useRef<Script | null>(null);
  const cover = box(-8, -8, 0, PW * 2 + 18, PH + 16, 5);
  const block = box(0, 0, 5, PW * 2 + 2, PH, 5);
  const [sx, sy] = iso(PW, PH / 2, 0);

  const rest = (n: number) => (n > 0 ? at(rows[n - 1].u0 + rows[n - 1].len + 6, rows[n - 1].v) : at(MARGIN_U, 9));
  const still = rest(saved);

  // Decide, once on the client, which lines are new for this student; hide those and put the hero where the writing starts.
  useLayoutEffect(() => {
    if (reduced) {
      script.current = null;
      lines.current.forEach((el) => el && (el.style.transform = ""));
      applyPose(hero.current, { ...rest(saved), lift: 0, tilt: 0, think: 0 });
      return;
    }
    const plan = linesPlan(saved, readSeen(projectId));
    if (plan.instant !== saved || readSeen(projectId) === null) writeSeen(projectId, plan.instant);
    const fill = (i: number, f: number) => {
      const el = lines.current[i];
      if (el) el.style.transform = `scaleX(${f.toFixed(3)})`;
    };
    plan.write.forEach((i) => fill(i, 0));
    const queue = [...plan.write];
    const idle = (): Step[] => [wait(5), think(1.3)];
    const writeLine = (i: number, from: Row): Step[] => {
      const start = at(from.u0 - 3, from.v);
      const mid = at(from.u0 + from.len / 2, from.v);
      const end = at(from.u0 + from.len + 6, from.v);
      const draw = (a: number, b: number) => (t: number) => fill(i, Math.min(1, (a + (b - a) * t) / from.len));
      return [
        hop(start, 0.5, 22),
        wait(0.15),
        run(mid, (from.len / 2 + 3) / RUN, draw(-3, from.len / 2)),
        think(1.3),
        run(end, (from.len / 2 + 6) / RUN, draw(from.len / 2, from.len + 6)),
        call(() => writeSeen(projectId, i + 1)),
        wait(0.35),
      ];
    };
    const p0 = { ...rest(plan.instant), lift: 0, tilt: 0, think: 0 };
    script.current = new Script(p0, () => {
      const i = queue.shift();
      return i === undefined ? idle() : writeLine(i, rows[i]);
    });
    applyPose(hero.current, p0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rows and rest follow from saved and total
  }, [saved, total, projectId, reduced]);

  useFrameLoop(live && !reduced, (dt) => script.current && applyPose(hero.current, script.current.tick(dt)));

  return (
    <svg viewBox="-190 -60 440 290" className="art-svg art-notebook" role="img" aria-label={`Note to Self, open: ${saved} of ${total} layers saved, one written line each`}>
      <defs>
        <radialGradient id="art-nb-shadow">
          <stop offset="0" stopColor="#000" stopOpacity="0.45" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="art-nb-spine" x1="0" x2="1">
          <stop offset="0" stopColor="#131b2d" stopOpacity="0" />
          <stop offset="0.5" stopColor="#131b2d" stopOpacity="0.22" />
          <stop offset="1" stopColor="#131b2d" stopOpacity="0" />
        </linearGradient>
      </defs>
      <ellipse cx={sx} cy={sy + 10} rx={220} ry={100} fill="url(#art-nb-shadow)" />
      <polygon points={cover.front} className="art-nb-cover-edge" />
      <polygon points={cover.side} className="art-nb-cover-side" />
      <polygon points={cover.top} className="art-nb-cover" />
      <polygon points={block.front} className="art-nb-edge" />
      <polygon points={block.side} className="art-nb-edge-side" />
      <g transform={onTop(0, 0, Z)}>
        <rect x={0} y={0} width={PW} height={PH} className="art-nb-page" />
        <rect x={PW} y={0} width={PW + 2} height={PH} className="art-nb-page art-nb-right" />
        <rect x={PW - 14} y={0} width={30} height={PH} fill="url(#art-nb-spine)" />
        {rows.map((r) => (
          <g key={r.v} className="art-nb-rule">
            <rect x={6} y={r.v + 0.9} width={PW - 12} height={0.5} />
            <rect x={PW + 8} y={r.v + 0.9} width={PW - 14} height={0.5} />
          </g>
        ))}
        <rect x={MARGIN_U} y={6} width={1.1} height={PH - 12} className="art-nb-margin" />
        {rows.slice(0, saved).map((r, i) => (
          <rect
            key={r.v}
            data-line={i}
            ref={(el) => void (lines.current[i] = el)}
            x={r.u0}
            y={r.v - 0.8}
            width={r.len}
            height={1.6}
            rx={0.8}
            className="art-nb-ink art-nb-line"
          />
        ))}
        <path d={`M${PW * 2 - 22} 0 h4 v${PH + 16} l-2 -3 l-2 3 z`} className="art-nb-ribbon" />
      </g>
      <Hero heroRef={hero} x={still.x} y={still.y} scale={SCALE} dots="#48536d" />
    </svg>
  );
});

