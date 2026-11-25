"use client";

import { motion, useMotionValueEvent, useScroll, useSpring, useTransform } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useReducedSafe } from "@/components/cinematic/useReducedSafe";
import { Button } from "@/components/ui/Button";
import type { WeekSummary } from "@/lib/weeks/notes";

/** One line under the number: a filled plum mark and "Has notes", or a hollow ring and "No notes yet". It reads without colour. */
function Status({ has }: { has: boolean }) {
  return (
    <p className="wk-status" data-notes={has ? "" : undefined}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="6" cy="6" r="4.6" fill={has ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.4" />
      </svg>
      {has ? "Has notes" : "No notes yet"}
    </p>
  );
}

const href = (projectId: string, week: number) => `/p/${projectId}/lecture-notes/${week}`;

/** The plain version, for reduced motion: the weeks as a list, no rolling. */
function WeekList({ projectId, weeks }: { projectId: string; weeks: WeekSummary[] }) {
  return (
    <ul className="wk-list" aria-label="Weeks">
      {weeks.map((w) => (
        <li key={w.week}>
          <Link href={href(projectId, w.week)}>
            <b>Week {w.week}</b>
            <span>{w.date ?? ""}</span>
            <span data-notes={w.hasNotes ? "" : undefined}>{w.hasNotes ? "Has notes" : "No notes yet"}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const TRAVEL = 0.34; // how much scrolling one week takes, as a share of the counter's height

/**
 * A big rolling counter, like an odometer. It starts at 1 (or at the week you came from) and scrolling rolls it, smoothly, to the last week;
 * when the scrolling stops it settles on a whole number. The number is a link: clicking it opens that week's notes.
 */
function Odometer({ projectId, weeks, start }: { projectId: string; weeks: WeekSummary[]; start: number }) {
  const n = weeks.length;
  const scroller = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(640);
  const [now, setNow] = useState(start);
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cell = Math.round(Math.max(120, Math.min(h * 0.4, 300)));
  const travel = Math.round(h * TRAVEL);
  const track = h + (n - 1) * travel;

  const { scrollYProgress } = useScroll({ container: scroller });
  const eased = useSpring(scrollYProgress, { stiffness: 170, damping: 28, mass: 0.7 });
  const y = useTransform(eased, (v) => -v * (n - 1) * cell);

  // start where asked, once the track has its height
  useEffect(() => {
    const el = scroller.current;
    if (el && n > 1) el.scrollTop = ((start - 1) / (n - 1)) * (el.scrollHeight - el.clientHeight);
  }, [start, n, track]);

  useMotionValueEvent(scrollYProgress, "change", (v) => {
    setNow(Math.min(n, Math.max(1, Math.round(v * (n - 1)) + 1)));
    clearTimeout(idle.current);
    idle.current = setTimeout(() => {
      const el = scroller.current;
      if (!el) return;
      const max = el.scrollHeight - el.clientHeight;
      const target = (Math.round(el.scrollTop / (max / (n - 1) || 1)) / (n - 1)) * max;
      if (Math.abs(target - el.scrollTop) > 1) el.scrollTo({ top: target, behavior: "smooth" });
    }, 160);
  });
  useEffect(() => () => clearTimeout(idle.current), []);

  const go = useCallback(
    (to: number) => {
      const el = scroller.current;
      if (el && n > 1) el.scrollTo({ top: ((Math.min(n, Math.max(1, to)) - 1) / (n - 1)) * (el.scrollHeight - el.clientHeight), behavior: "smooth" });
    },
    [n],
  );

  const week = weeks[now - 1] ?? weeks[0];
  return (
    <div
      className="wk-scroll"
      ref={scroller}
      tabIndex={0}
      role="region"
      aria-label="Weeks. Scroll to roll the counter, or use the arrow keys."
    >
      <div style={{ height: track }}>
        <div className="wk-stage" style={{ height: h }}>
          <div className="wk-window" style={{ height: cell * 1.5 }}>
            <motion.div className="wk-strip" style={{ y, top: (cell * 1.5 - cell) / 2 }} aria-hidden="true">
              {weeks.map((w) => (
                <div className="wk-cell" key={w.week} style={{ height: cell, fontSize: cell * 0.86 }}>
                  {w.week}
                </div>
              ))}
            </motion.div>
            <Link className="wk-open" href={href(projectId, week.week)} aria-label={`Open the notes for Week ${week.week}`} />
          </div>
          <div className="wk-caption" aria-live="polite">
            <p className="wk-week">Week {week.week}</p>
            {week.date ? <p className="wk-date">{week.date}</p> : <p className="wk-date" aria-hidden="true" />}
            <Status has={week.hasNotes} />
          </div>
          <div className="wk-step">
            <Button variant="quiet" onClick={() => go(now - 1)} disabled={now <= 1}>
              Earlier week
            </Button>
            <Button variant="quiet" onClick={() => go(now + 1)} disabled={now >= n}>
              Later week
            </Button>
          </div>
          <p className="wk-hint">Click the number to open that week.</p>
        </div>
      </div>
    </div>
  );
}

export function WeekCounter({ projectId, weeks, start }: { projectId: string; weeks: WeekSummary[]; start: number }) {
  const reduced = useReducedSafe();
  if (reduced) return <WeekList projectId={projectId} weeks={weeks} />;
  return <Odometer projectId={projectId} weeks={weeks} start={start} />;
}
