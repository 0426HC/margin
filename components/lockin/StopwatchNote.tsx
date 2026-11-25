"use client";

import { useEffect, useState } from "react";
import { Body, STOPWATCH } from "@/components/cinematic/Agents";
import "@/components/cinematic/agents.css";
import { ago, stopwatchLine } from "@/lib/lockin/timer";
import { anotherRound, startBreak, stopTimer, useTimer } from "@/lib/lockin/timerStore";

/** The stopwatch, standing, with its hand ticking round. */
export function StopwatchAvatar({ size = 40 }: { size?: number }) {
  return (
    <svg className="sw-avatar" viewBox="0 0 40 46" width={size} height={(size * 46) / 40} aria-hidden="true" style={{ ["--c" as string]: STOPWATCH.color }}>
      <Body id="stopwatch" />
    </svg>
  );
}

/**
 * When the focus timer (or a break) is up, the stopwatch says so: bottom left, where the other agents' notes appear. No sound. It is the
 * only agent allowed to speak while locked in. Mounted once, at the root, so it shows on whatever page the student is on.
 */
export function StopwatchNote() {
  const { state } = useTimer();
  const [now, setNow] = useState(0); // set from the timers below: Date.now() may not run while the page is rendered on the server
  const finished = state.phase === "finished" ? state : null;

  // "just now", then "1 min ago": refresh the age while the note is up.
  useEffect(() => {
    if (!finished) return;
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 20_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [finished]);

  // The live region is always in the page, so a screen reader hears the stopwatch when it speaks (a region added with its words is often missed).
  const said = <p className="sr-only" aria-live="polite">{finished ? stopwatchLine(finished) : ""}</p>;
  if (!finished) return said;
  return (
    <>
    {said}
    <aside className="sw-note lk-motion-ok" aria-label="Stopwatch" key={finished.at}>
      <span className="sw-note-avatar">
        <StopwatchAvatar size={38} />
      </span>
      <div className="sw-note-body">
        <p className="sw-note-meta">
          <b>{STOPWATCH.name}</b> · {ago(finished.at, now)}
        </p>
        <p className="sw-note-line">{stopwatchLine(finished)}</p>
        <span className="sw-note-actions">
          {finished.kind === "focus" && (
            <button type="button" className="lk-btn" onClick={() => startBreak()}>
              Take a break
            </button>
          )}
          <button type="button" className="lk-btn lk-btn-primary" onClick={() => anotherRound()}>
            Another round
          </button>
        </span>
      </div>
      <button type="button" className="wa-x sw-note-x" onClick={() => stopTimer()} aria-label="Dismiss">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </aside>
    </>
  );
}
