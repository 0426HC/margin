import { EngineAborted } from "./errors";

// At most N claude processes at once. The pool lives on globalThis so Next dev hot-reload can't create a second one.
type Pool = { limit: number; running: number; waiting: Array<() => void> };
const KEY = "__margin_engine_pool__";

function pool(): Pool {
  const g = globalThis as unknown as Record<string, Pool>;
  return (g[KEY] ??= { limit: 2, running: 0, waiting: [] });
}

export function setConcurrency(limit: number) {
  pool().limit = limit;
}

/** Wait for a slot. Resolves to a release function (call once). Rejects if the signal aborts while waiting. */
export function acquire(signal?: AbortSignal): Promise<() => void> {
  const p = pool();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new EngineAborted());
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      p.running--;
      p.waiting.shift()?.();
    };
    const start = () => {
      signal?.removeEventListener("abort", onAbort);
      p.running++;
      resolve(release);
    };
    const onAbort = () => {
      const i = p.waiting.indexOf(start);
      if (i >= 0) p.waiting.splice(i, 1);
      reject(new EngineAborted());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (p.running < p.limit) start();
    else p.waiting.push(start);
  });
}

export const stats = () => ({ running: pool().running, waiting: pool().waiting.length });
