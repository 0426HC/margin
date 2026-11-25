"use client";

import { useEffect, useId, useRef, useState } from "react";
import { DEFAULT_MINUTES, MAX_MINUTES, MIN_MINUTES, clock, leftMs, readMinutes, remaining } from "@/lib/lockin/timer";
import { lastMinutes, pauseTimer, resumeTimer, startFocus, stopTimer, useTimer } from "@/lib/lockin/timerStore";

const R = 6.25;
const C = 2 * Math.PI * R;

/**
 * The focus timer, lock in only: a small pill beside the switch. Idle, it opens "Focus for how long?". Running, it shows the countdown
 * and a thin plum ring that empties; clicking it offers pause, resume or stop. A break is labelled as one.
 */
export function FocusTimer() {
  const { state, now } = useTimer();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const panelId = useId();
  const active = state.phase === "running" || state.phase === "paused";
  const left = leftMs(state, now);
  const isBreak = active && state.kind === "break";
  // closing the panel from inside it (Start, Stop, Escape) puts focus back on the pill, never on the page
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => wrap.current?.querySelector<HTMLButtonElement>(".lk-timer")?.focus());
  };

  // Close on Escape or a click elsewhere; focus goes back to the pill.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="lk-timer-wrap" ref={wrap}>
      <button
        type="button"
        className="lk-pill lk-timer"
        data-phase={state.phase}
        data-kind={active ? state.kind : undefined}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={active ? `${isBreak ? "Break" : "Focus timer"}, ${state.phase === "paused" ? "paused" : "running"}` : "Focus timer"}
        onClick={() => setOpen((o) => !o)}
      >
        {active ? (
          <>
            <svg className="lk-ring" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r={R} className="lk-ring-track" />
              <circle cx="8" cy="8" r={R} className="lk-ring-left" strokeDasharray={`${C * remaining(state, now)} ${C}`} transform="rotate(-90 8 8)" />
            </svg>
            {isBreak && <span className="lk-timer-kind">Break</span>}
            <span className="lk-timer-clock" role="timer">
              {clock(left)}
            </span>
            {state.phase === "paused" && <span className="lk-timer-kind">Paused</span>}
          </>
        ) : (
          <span>Focus timer</span>
        )}
      </button>
      {open && (
        <div className="lk-panel" id={panelId} role="dialog" aria-label={active ? (isBreak ? "Break" : "Focus timer") : "Focus for how long?"}>
          {active ? <Running paused={state.phase === "paused"} isBreak={isBreak} left={clock(left)} onDone={close} /> : <Setup onStarted={close} />}
        </div>
      )}
    </span>
  );
}

function Setup({ onStarted }: { onStarted: () => void }) {
  const last = lastMinutes();
  const [text, setText] = useState(String(last ?? DEFAULT_MINUTES));
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  return (
    <form
      className="lk-setup"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const n = readMinutes(text);
        if (n === null) return setError(`Type a whole number of minutes from ${MIN_MINUTES} to ${MAX_MINUTES}.`);
        startFocus(n);
        onStarted();
      }}
    >
      <label htmlFor={id} className="lk-panel-title">
        Focus for how long?
      </label>
      <span className="lk-minutes">
        <input
          ref={input}
          id={id}
          type="number"
          inputMode="numeric"
          min={MIN_MINUTES}
          max={MAX_MINUTES}
          step={1}
          value={text}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-hint`}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
        />
        <span>minutes</span>
      </span>
      <p className="lk-panel-line" id={`${id}-hint`}>
        {error ?? (last ? `Last time: ${last} ${last === 1 ? "minute" : "minutes"}` : `From ${MIN_MINUTES} to ${MAX_MINUTES} minutes.`)}
      </p>
      <button type="submit" className="lk-btn lk-btn-primary">
        Start
      </button>
    </form>
  );
}

function Running({ paused, isBreak, left, onDone }: { paused: boolean; isBreak: boolean; left: string; onDone: () => void }) {
  return (
    <div className="lk-running">
      <p className="lk-panel-title">
        {isBreak ? "Break" : "Focus"}: {left} left{paused ? ", paused" : ""}
      </p>
      <span className="lk-panel-actions">
        {paused ? (
          <button type="button" className="lk-btn lk-btn-primary" onClick={() => resumeTimer()}>
            Resume
          </button>
        ) : (
          <button type="button" className="lk-btn lk-btn-primary" onClick={() => pauseTimer()}>
            Pause
          </button>
        )}
        <button
          type="button"
          className="lk-btn"
          onClick={() => {
            stopTimer();
            onDone();
          }}
        >
          Stop
        </button>
      </span>
    </div>
  );
}
