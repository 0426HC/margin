"use client";

import { useReducedMotion } from "motion/react";
import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { HINT_KEY, MODE_KEY } from "./keys";

/**
 * Lock in: one switch that turns off everything decorative or moving. The mode lives on <html data-lockin>, which the CSS (Graphite
 * colours, hidden decoration, no transitions) reads, and in this small store, which the components that render differently read.
 * The last mode is remembered in localStorage; an inline script in the root layout puts the attribute back before the first paint.
 */
let on: boolean | null = null;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const snapshot = () => (on ??= document.documentElement.hasAttribute("data-lockin"));

export function useLockIn(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

/** Reduced motion, or lock in: either way nothing should move that the student did not move. */
export function useQuietMotion(): boolean {
  const reduced = useReducedMotion();
  return useLockIn() || Boolean(reduced);
}

export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // private windows and blocked storage: the mode still works, it just isn't remembered
  }
}

type Transitioning = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };

/**
 * Switch lock in on or off. The colours, the decoration and the layout change in one step inside a View Transition, so the whole room
 * crossfades over half a second (see lockin.css). Without View Transitions it changes at once.
 */
export function setLockIn(next: boolean) {
  if (next === snapshot()) return;
  writeStored(MODE_KEY, next ? "lock-in" : "normal");
  dismissHint(); // using the switch counts as having seen the hint
  const apply = () => {
    on = next;
    document.documentElement.toggleAttribute("data-lockin", next);
    flushSync(() => listeners.forEach((l) => l()));
  };
  const doc = document as Transitioning;
  if (doc.startViewTransition && !document.hidden) doc.startViewTransition(apply);
  else apply();
  window.dispatchEvent(new CustomEvent("margin:lock-in", { detail: next }));
}

const hintListeners = new Set<() => void>();
export const subscribeHint = (l: () => void) => (hintListeners.add(l), () => void hintListeners.delete(l));
export function dismissHint() {
  writeStored(HINT_KEY, "1");
  hintListeners.forEach((l) => l());
}
