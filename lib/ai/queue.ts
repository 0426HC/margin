import type { Priority } from "./engine";
import { EngineAborted } from "./errors";

/**
 * At most `limit` claude processes at once, and background work (the brain, layers written ahead) at most `background` of them, so a call
 * the student is waiting for always finds a place at once and runs side by side with the background. Waiting calls for the student go
 * before waiting background calls. The pool lives on globalThis so Next dev hot-reload can't create a second one.
 */
/** A call's priority, read whenever the queue decides: a background layer the student opens is moved up while it waits. */
type PriorityOf = Priority | (() => Priority);
type Waiter = { priority: PriorityOf; start: (as: Priority) => void };
type Pool = { limit: number; background: number; running: { now: number; background: number }; waiting: Waiter[] };
const KEY = "__margin_engine_pool_v2__";

function pool(): Pool {
  const g = globalThis as unknown as Record<string, Pool>;
  return (g[KEY] ??= { limit: 5, background: 2, running: { now: 0, background: 0 }, waiting: [] });
}

export function setConcurrency(limit: number, background = Math.max(1, limit - 1)) {
  pool().limit = limit;
  pool().background = Math.min(background, limit);
}

const total = (p: Pool) => p.running.now + p.running.background;
const fits = (p: Pool, priority: Priority) => total(p) < p.limit && (priority === "now" || p.running.background < p.background);

const valueOf = (p: PriorityOf): Priority => (typeof p === "function" ? p() : p);

/** Start every waiting call that now fits: the student's first, then background, each in the order they asked. */
function drain(p: Pool) {
  for (const priority of ["now", "background"] as const) {
    for (let i = 0; i < p.waiting.length; ) {
      const w = p.waiting[i];
      if (valueOf(w.priority) === priority && fits(p, priority)) {
        p.waiting.splice(i, 1);
        w.start(priority);
      } else i++;
    }
  }
}

/** Look at the waiting calls again (a priority changed). */
export const requeue = () => drain(pool());

/** Wait for a place. Resolves to a release function (call once). Rejects if the signal aborts while waiting. */
export function acquire(signal?: AbortSignal, priority: PriorityOf = "now"): Promise<() => void> {
  const p = pool();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new EngineAborted());
    let released = false;
    let ranAs: Priority = "now";
    const release = () => {
      if (released) return;
      released = true;
      p.running[ranAs]--;
      drain(p);
    };
    const waiter: Waiter = {
      priority,
      start: (as) => {
        signal?.removeEventListener("abort", onAbort);
        ranAs = as;
        p.running[as]++;
        resolve(release);
      },
    };
    const onAbort = () => {
      const i = p.waiting.indexOf(waiter);
      if (i >= 0) p.waiting.splice(i, 1);
      reject(new EngineAborted());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    p.waiting.push(waiter);
    drain(p);
  });
}

export const stats = () => ({ running: total(pool()), waiting: pool().waiting.length });
