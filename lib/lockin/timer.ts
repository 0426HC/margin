/**
 * The focus timer, as pure functions. Time left is always worked out from timestamps (endsAt - now), never by counting ticks, so it
 * stays right when the tab is in the background and its timers are slowed down.
 */
export type TimerKind = "focus" | "break";
export type TimerState =
  | { phase: "idle" }
  | { phase: "running"; kind: TimerKind; minutes: number; endsAt: number; totalMs: number }
  | { phase: "paused"; kind: TimerKind; minutes: number; leftMs: number; totalMs: number }
  | { phase: "finished"; kind: TimerKind; minutes: number; /** When time was up. */ at: number };

export const BREAK_MINUTES = 5;
export const MIN_MINUTES = 1;
export const MAX_MINUTES = 240;
export const DEFAULT_MINUTES = 25;
export const IDLE: TimerState = { phase: "idle" };

/** What the student typed, as whole minutes from 1 to 240, or null if it isn't one. */
export function readMinutes(text: string): number | null {
  if (!/^\s*\d+\s*$/.test(text)) return null;
  const n = Number(text);
  return n >= MIN_MINUTES && n <= MAX_MINUTES ? n : null;
}

export function start(kind: TimerKind, minutes: number, now: number): TimerState {
  const totalMs = minutes * 60_000;
  return { phase: "running", kind, minutes, endsAt: now + totalMs, totalMs };
}

export function leftMs(s: TimerState, now: number): number {
  if (s.phase === "running") return Math.max(0, s.endsAt - now);
  if (s.phase === "paused") return s.leftMs;
  return 0;
}

/** How much of the ring is left: 1 when it starts, 0 when time is up. */
export function remaining(s: TimerState, now: number): number {
  if (s.phase !== "running" && s.phase !== "paused") return 0;
  return s.totalMs ? leftMs(s, now) / s.totalMs : 0;
}

export function pause(s: TimerState, now: number): TimerState {
  return s.phase === "running" ? { phase: "paused", kind: s.kind, minutes: s.minutes, leftMs: leftMs(s, now), totalMs: s.totalMs } : s;
}

export function resume(s: TimerState, now: number): TimerState {
  return s.phase === "paused" ? { phase: "running", kind: s.kind, minutes: s.minutes, endsAt: now + s.leftMs, totalMs: s.totalMs } : s;
}

/** A running timer whose time is up becomes finished; anything else stays as it is. */
export function advance(s: TimerState, now: number): TimerState {
  return s.phase === "running" && now >= s.endsAt ? { phase: "finished", kind: s.kind, minutes: s.minutes, at: s.endsAt } : s;
}

/** "24:13". Seconds round up, so the clock reads 25:00 at the start and 00:01 in the last second. */
export function clock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** A stored timer, checked: anything that doesn't look like one is idle. */
export function parseStored(raw: string | null): TimerState {
  if (!raw) return IDLE;
  try {
    const s = JSON.parse(raw) as TimerState;
    const kindOk = (k: unknown) => k === "focus" || k === "break";
    const num = (n: unknown) => typeof n === "number" && Number.isFinite(n);
    if (s.phase === "running" && kindOk(s.kind) && num(s.endsAt) && num(s.totalMs) && num(s.minutes)) return s;
    if (s.phase === "paused" && kindOk(s.kind) && num(s.leftMs) && num(s.totalMs) && num(s.minutes)) return s;
    if (s.phase === "finished" && kindOk(s.kind) && num(s.minutes) && num(s.at)) return s;
  } catch {
    // fall through
  }
  return IDLE;
}

/** "just now", then "3 min ago": how long ago the stopwatch spoke. */
export function ago(at: number, now: number): string {
  const m = Math.floor((now - at) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`;
}

/** What the stopwatch says when time is up. */
export function stopwatchLine(s: { kind: TimerKind; minutes: number }): string {
  return s.kind === "break" ? "Break’s over. Ready for another round?" : `${s.minutes} ${s.minutes === 1 ? "minute" : "minutes"} done. Take 5, or go another round?`;
}
