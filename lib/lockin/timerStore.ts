"use client";

import { useEffect, useSyncExternalStore } from "react";
import { LAST_LENGTH_KEY, TIMER_KEY } from "./keys";
import { readStored, writeStored } from "./store";
import { BREAK_MINUTES, DEFAULT_MINUTES, IDLE, advance, leftMs, parseStored, pause, resume, start, type TimerState } from "./timer";

/**
 * The focus timer's one copy, shared by the pill in every top bar and the stopwatch's note. It is kept in localStorage, so it survives
 * moving between pages and a reload. Lock in only: switching lock in off ends it.
 */
type View = { state: TimerState; now: number };
let view: View | null = null;
const SERVER: View = { state: IDLE, now: 0 };
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

function current(): View {
  if (!view) {
    const now = Date.now();
    const locked = document.documentElement.hasAttribute("data-lockin");
    view = { state: locked ? advance(parseStored(readStored(TIMER_KEY)), now) : IDLE, now };
  }
  return view;
}

function set(state: TimerState, now = Date.now()) {
  view = { state, now };
  writeStored(TIMER_KEY, JSON.stringify(state));
  listeners.forEach((l) => l());
}

export function useTimer(): View {
  return useSyncExternalStore(subscribe, current, () => SERVER);
}

export function lastMinutes(): number | null {
  const n = Number(readStored(LAST_LENGTH_KEY));
  return Number.isInteger(n) && n >= 1 && n <= 240 ? n : null;
}

export function startFocus(minutes: number) {
  writeStored(LAST_LENGTH_KEY, String(minutes));
  const now = Date.now();
  set(start("focus", minutes, now), now);
}
export function startBreak() {
  const now = Date.now();
  set(start("break", BREAK_MINUTES, now), now);
}
/** "Another round": the last length again. */
export function anotherRound() {
  startFocus(lastMinutes() ?? DEFAULT_MINUTES);
}
export function pauseTimer() {
  const now = Date.now();
  set(pause(current().state, now), now);
}
export function resumeTimer() {
  const now = Date.now();
  set(resume(current().state, now), now);
}
export function stopTimer() {
  set(IDLE);
}

/** Move the clock on: notify only when the shown second changes or the time is up, so the pill renders once a second. */
export function tickTimer(now = Date.now()) {
  const v = current();
  const next = advance(v.state, now);
  if (next !== v.state) return set(next, now);
  if (Math.ceil(leftMs(v.state, now) / 1000) !== Math.ceil(leftMs(v.state, v.now) / 1000)) {
    view = { state: v.state, now };
    listeners.forEach((l) => l());
  }
}

/** Mounted once (the root): ticks while a timer runs, catches up as soon as a hidden tab is shown again, and ends the timer when lock in is switched off. */
export function useTimerDriver() {
  const { state } = useTimer();
  const running = state.phase === "running";
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => tickTimer(), 250);
    const onShow = () => tickTimer();
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, [running]);
  useEffect(() => {
    const onMode = (e: Event) => {
      if ((e as CustomEvent<boolean>).detail === false && current().state.phase !== "idle") stopTimer();
    };
    window.addEventListener("margin:lock-in", onMode);
    return () => window.removeEventListener("margin:lock-in", onMode);
  }, []);
}
