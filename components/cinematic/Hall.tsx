"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Body } from "./Agents";
import { AGENTS, demoTask, type AgentId, type AgentMode } from "./agentState";
import { rgbCss, type RGB } from "./theme";
import "./hall.css";

// The dining hall, seen from above. The room is a 1200 x 700 world; a camera scales it to fit.
// Everything that moves is a transform, so the scene runs on the compositor.
const W = 1200;
const H = 700;
const C = { x: 600, y: 350 };
const R_CENTER = 118;
const R_SIDE = 66;
const rad = (deg: number) => (deg * Math.PI) / 180;
const polar = (cx: number, cy: number, r: number, deg: number) => ({ x: cx + r * Math.cos(rad(deg)), y: cy + r * Math.sin(rad(deg)) });

const ANGLE = AGENTS.map((_, i) => -90 + i * 72);
/** Idle and done: all five around the one table. */
const SHARED = ANGLE.map((a) => polar(C.x, C.y, R_CENTER + 26, a));
/** Busy: five round tables, one per agent, in a ring. */
const TABLES = ANGLE.map((a) => {
  const t = { x: C.x + 330 * Math.cos(rad(a)), y: C.y + 215 * Math.sin(rad(a)) };
  const dx = C.x - t.x;
  const dy = C.y - t.y;
  const len = Math.hypot(dx, dy);
  const u = { x: dx / len, y: dy / len };
  return { ...t, u, seat: { x: t.x + u.x * (R_SIDE + 26), y: t.y + u.y * (R_SIDE + 26) } };
});

const SPEED = 240; // world units per second when running
const TALK_MS = 2300;

function useBox(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

type Props = {
  mode: AgentMode;
  accent: RGB;
  /** Where the middle of the room sits in the frame, as fractions of its width and height. */
  focus?: [number, number];
  reduced: boolean;
  /** A line about what the room is doing, shown small in the corner. */
  caption?: string;
};

export function Hall({ mode, accent, focus = [0.5, 0.5], reduced, caption }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const size = useBox(root);
  const busy = mode === "busy";
  const first = useRef(true);
  const rug = useId();
  const [ready, setReady] = useState(false);
  // No camera move on first paint: the room starts where it should be, then animates on mode changes.
  useEffect(() => {
    if (!size.w) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
    return () => cancelAnimationFrame(id);
  }, [size.w]);

  // Camera: close on the shared table when it is quiet, wide enough for all five tables when busy.
  const idleScale = Math.min(size.w / 520, size.h / 430);
  const busyScale = Math.min(size.w / 800, size.h / 590);
  const scale = Math.max(0.1, busy ? busyScale : idleScale);

  // Walking: whenever the room changes mode, everyone walks to their new place.
  useEffect(() => {
    const el = root.current;
    if (first.current) {
      first.current = false;
      return;
    }
    if (!el || reduced) return;
    el.dataset.walk = "";
    const id = window.setTimeout(() => delete el.dataset.walk, 2300);
    return () => {
      window.clearTimeout(id);
      delete el.dataset.walk;
    };
  }, [mode, reduced]);

  // Busy: agents get up, run to each other's tables, talk, and run back. Several trips overlap.
  useEffect(() => {
    const el = root.current;
    if (!el || mode !== "busy" || reduced) return;
    const nodes = Object.fromEntries(AGENTS.map((a) => [a.id, el.querySelector<HTMLElement>(`[data-agent="${a.id}"]`)!]));
    const trips = new Map<AgentId, { anim: Animation; timers: number[]; to: AgentId }>();
    let schedule = 0;
    const idx = (id: AgentId) => AGENTS.findIndex((a) => a.id === id);

    const start = () => {
      const free = AGENTS.map((a) => a.id).filter((id) => !trips.has(id) && ![...trips.values()].some((t) => t.to === id));
      if (free.length >= 2 && trips.size < 3) {
        const from = free[Math.floor(Math.random() * free.length)];
        const targets = free.filter((id) => id !== from);
        const to = targets[Math.floor(Math.random() * targets.length)];
        const a = TABLES[idx(from)].seat;
        const b = TABLES[idx(to)].seat;
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const d = { x: (a.x - b.x) / dist, y: (a.y - b.y) / dist };
        const stop = { x: b.x + d.x * 54 - a.x, y: b.y + d.y * 54 - a.y }; // stands beside them, on the side it came from
        const run = (Math.hypot(stop.x, stop.y) / SPEED) * 1000;
        const total = run * 2 + TALK_MS;
        const trip = nodes[from].querySelector<HTMLElement>(".hall-trip")!;
        const anim = trip.animate(
          [
            { transform: "translate(0px, 0px)", offset: 0, easing: "ease-in-out" },
            { transform: `translate(${stop.x}px, ${stop.y}px)`, offset: run / total },
            { transform: `translate(${stop.x}px, ${stop.y}px)`, offset: (run + TALK_MS) / total, easing: "ease-in-out" },
            { transform: "translate(0px, 0px)", offset: 1 },
          ],
          { duration: total, fill: "none" },
        );
        const timers: number[] = [];
        nodes[from].dataset.run = "";
        timers.push(
          window.setTimeout(() => {
            delete nodes[from].dataset.run;
            nodes[from].dataset.talk = "";
            nodes[to].dataset.talk = "";
          }, run),
          window.setTimeout(() => {
            delete nodes[from].dataset.talk;
            delete nodes[to].dataset.talk;
            nodes[from].dataset.run = "";
          }, run + TALK_MS),
          window.setTimeout(() => {
            delete nodes[from].dataset.run;
            trips.delete(from);
          }, total),
        );
        trips.set(from, { anim, timers, to });
      }
      schedule = window.setTimeout(start, 700 + Math.random() * 1500);
    };
    schedule = window.setTimeout(start, 3000); // let everyone reach their own table first

    return () => {
      window.clearTimeout(schedule);
      for (const [id, t] of trips) {
        t.anim.cancel();
        t.timers.forEach(clearTimeout);
        for (const n of [nodes[id], nodes[t.to]]) {
          delete n.dataset.run;
          delete n.dataset.talk;
        }
      }
    };
  }, [mode, reduced]);

  const tint = rgbCss(accent, 0.24);
  const book = rgbCss(accent, 0.9);
  const cup = useMemo(() => {
    const a = polar(C.x, C.y, R_CENTER - 54, ANGLE[1] + 12);
    const b = polar(C.x, C.y, R_CENTER - 54, ANGLE[3] - 12);
    return { a, dx: b.x - a.x, dy: b.y - a.y };
  }, []);

  return (
    <div className="hall" ref={root} data-mode={mode} data-reduced={reduced ? "" : undefined} data-ready={ready ? "" : undefined} aria-hidden="true">
      <div
        className="hall-cam"
        style={{
          // The camera's centre sits mid-frame; the focus shifts it by transform, so moving it animates.
          transform: `translate(${(busy ? 0 : focus[0] - 0.5) * size.w}px, ${(busy ? 0 : focus[1] - 0.5) * size.h}px) scale(${scale})`,
          visibility: size.w ? "visible" : "hidden",
        }}
      >
        <svg className="hall-floor" width={3600} height={2100} viewBox={`${-W} ${-H} ${W * 3} ${H * 3}`}>
          <rect x={-W} y={-H} width={W * 3} height={H * 3} fill="#151d30" />
          {Array.from({ length: 60 }, (_, i) => (
            <line key={i} x1={-W} x2={W * 2} y1={-H + i * 35} y2={-H + i * 35} stroke="#0c1220" strokeWidth="2" opacity="0.7" />
          ))}
          <rect x={-W} y={-H} width={W * 3} height={H * 3} fill={tint} opacity="0.5" />
        </svg>

        <svg className="hall-props" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          <defs>
            <radialGradient id={rug}>
              <stop offset="55%" stopColor={rgbCss(accent, 0.34)} />
              <stop offset="100%" stopColor={rgbCss(accent, 0)} />
            </radialGradient>
          </defs>
          <g className="hall-shared">
            <circle cx={C.x} cy={C.y} r={215} fill={`url(#${rug})`} />
            {SHARED.map((s, i) => {
              const a = polar(C.x, C.y, R_CENTER + 20, ANGLE[i]);
              return <rect key={i} className="hall-chair" x={-23} y={-18} width={46} height={36} rx={9} transform={`translate(${a.x} ${a.y}) rotate(${ANGLE[i]})`} />;
            })}
            <circle className="hall-table" cx={C.x} cy={C.y} r={R_CENTER} />
            <circle className="hall-table-ring" cx={C.x} cy={C.y} r={R_CENTER - 12} />
            {ANGLE.map((a, i) => {
              const plate = polar(C.x, C.y, R_CENTER - 34, a);
              const mug = polar(C.x, C.y, R_CENTER - 36, a + 14);
              return (
                <g key={i}>
                  <circle className="hall-plate" cx={plate.x} cy={plate.y} r={16} />
                  <circle className="hall-plate-in" cx={plate.x} cy={plate.y} r={9} />
                  <circle className="hall-mug" cx={mug.x} cy={mug.y} r={5.5} />
                </g>
              );
            })}
            <g transform={`translate(${C.x - 78} ${C.y - 22}) rotate(-18)`}>
              <rect width="30" height="21" rx="2" fill={book} />
              <rect x="3" y="3" width="24" height="3" fill="rgb(240 244 252 / 0.5)" />
            </g>
            <g transform={`translate(${C.x + 40} ${C.y + 30}) rotate(24)`}>
              <rect width="28" height="19" rx="2" fill="#edf0f6" />
              <rect x="3" y="3" width="22" height="2" fill="rgb(19 27 45 / 0.45)" />
            </g>
            <circle cx={C.x} cy={C.y} r={11} fill="rgb(184 198 236 / 0.22)" />
            <circle cx={C.x} cy={C.y} r={6} fill="#b8c6ec" />
            <g transform={`translate(${cup.a.x} ${cup.a.y})`}>
              <g className="hall-cup-pass" style={{ ["--dx" as string]: `${cup.dx}px`, ["--dy" as string]: `${cup.dy}px` }}>
                <circle r="6.5" fill="#edf0f6" stroke="rgb(0 0 0 / 0.4)" />
                <circle r="3.6" fill="#2a3552" />
                <path d="M6.5 -2a3 3 0 0 1 0 5" fill="none" stroke="#edf0f6" strokeWidth="1.6" />
              </g>
            </g>
          </g>

          <g className="hall-five">
            {TABLES.map((t, i) => {
              const side = { x: -t.u.y, y: t.u.x };
              const plate = { x: t.x + t.u.x * (R_SIDE - 26), y: t.y + t.u.y * (R_SIDE - 26) };
              const rot = (Math.atan2(t.u.y, t.u.x) * 180) / Math.PI;
              return (
                <g key={i} style={{ ["--n" as string]: i }}>
                  <circle cx={t.x} cy={t.y} r={118} fill={`url(#${rug})`} />
                  <rect className="hall-chair" x={-21} y={-16} width={42} height={32} rx={8} transform={`translate(${t.x + t.u.x * (R_SIDE + 20)} ${t.y + t.u.y * (R_SIDE + 20)}) rotate(${rot})`} />
                  <circle className="hall-table" cx={t.x} cy={t.y} r={R_SIDE} />
                  <circle className="hall-table-ring" cx={t.x} cy={t.y} r={R_SIDE - 9} />
                  <circle className="hall-plate" cx={plate.x} cy={plate.y} r={12} />
                  <circle className="hall-plate-in" cx={plate.x} cy={plate.y} r={6.5} />
                  <circle className="hall-mug" cx={plate.x + side.x * 24} cy={plate.y + side.y * 24} r={5} />
                  <g transform={`translate(${t.x - t.u.x * 16 - 13} ${t.y - t.u.y * 16 - 9}) rotate(${i * 37})`}>
                    <rect width="26" height="18" rx="2" fill={AGENTS[i].color} />
                    <rect x="3" y="3" width="20" height="2" fill="rgb(19 27 45 / 0.4)" />
                  </g>
                  <circle cx={t.x - t.u.x * 38} cy={t.y - t.u.y * 38} r={4.5} fill="#b8c6ec" />
                </g>
              );
            })}
          </g>
        </svg>

        {AGENTS.map((a, i) => {
          const p = busy ? TABLES[i].seat : SHARED[i];
          const toTable = { x: C.x - SHARED[i].x, y: C.y - SHARED[i].y };
          const len = Math.hypot(toTable.x, toTable.y);
          return (
            <div
              key={a.id}
              className="hall-agent"
              data-agent={a.id}
              data-working={busy ? "" : undefined}
              style={{
                transform: `translate(${p.x}px, ${p.y}px)`,
                transitionDelay: `${i * 90}ms`,
                ["--c" as string]: a.color,
                ["--i" as string]: i,
                ["--lx" as string]: `${(toTable.x / len) * 5}px`,
                ["--ly" as string]: `${(toTable.y / len) * 5}px`,
              }}
            >
              <div className="hall-trip">
                <div className="hall-lean">
                  <div className="hall-bob">
                    <svg viewBox="0 0 40 46" width="52" height="60">
                      <Body id={a.id} />
                    </svg>
                  </div>
                </div>
                <span className="hall-talk">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="hall-scrim" />
      {caption && mode !== "idle" && <p className="hall-caption">{mode === "busy" ? demoTask.summary : caption}</p>}
    </div>
  );
}
