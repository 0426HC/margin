/**
 * Where the writing of a layer is, so the page can show it while it waits: each step in plain words, and the explanation so far as Claude
 * writes it, so the student starts reading within seconds. One record per layer that is being written, kept on globalThis (Next's dev
 * reloads must not lose it); a page that comes back while the work is still running picks it up, text and all.
 */

export type LayerStep = "source" | "explained" | "check";
export type StepState = "waiting" | "working" | "done";

export interface LayerProgress {
  steps: Record<LayerStep, StepState>;
  /** When the work started (ms since epoch), for "1 min 20 s so far". */
  startedAt: number;
  /** When anything last happened: new text, a step done. Margin stops only when nothing happens for `idleMs`. */
  activeAt: number;
  idleMs: number;
  /** The explanation so far, in the text format of `explained-text.ts`. */
  text: string;
  /** Set once it ended: done, or failed with a message that says what happened. */
  outcome?: { ok: true } | { ok: false; code: string; message: string; kept: LayerStep[] };
}

/** The steps in the order the page lists them, with the words it uses. */
export const STEP_WORDS: { step: LayerStep; label: string }[] = [
  { step: "source", label: "Choosing the passages from your files" },
  { step: "explained", label: "Writing the explanation" },
  { step: "check", label: "Checking every citation and named idea against your files" },
];

/** "3 minutes", "1 minute", or "12 seconds" under a minute. */
export function spanWords(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} seconds`;
  const m = Math.round(ms / 60_000);
  return `${m} ${m === 1 ? "minute" : "minutes"}`;
}

type Entry = { progress: LayerProgress; listeners: Set<(p: LayerProgress) => void>; timer: ReturnType<typeof setTimeout> | null; beat: ReturnType<typeof setTimeout> | null };
const KEY = "__margin_layer_progress_v2__";
const registry = (): Map<string, Entry> => ((globalThis as unknown as Record<string, Map<string, Entry>>)[KEY] ??= new Map());

/** New text is passed on at most this often, so a fast stream doesn't flood the page. */
const TEXT_EVERY_MS = 200;

const tell = (entry: Entry) => entry.listeners.forEach((l) => l(entry.progress));

export function startProgress(layerId: string, idleMs: number): LayerProgress {
  const steps: Record<LayerStep, StepState> = { source: "waiting", explained: "waiting", check: "waiting" };
  const now = Date.now();
  const progress: LayerProgress = { steps, startedAt: now, activeAt: now, idleMs, text: "" };
  const entry = registry().get(layerId);
  if (entry) {
    entry.progress = progress;
    tell(entry);
  } else registry().set(layerId, { progress, listeners: new Set(), timer: null, beat: null });
  return progress;
}

export function setStep(layerId: string, step: LayerStep, state: StepState) {
  const entry = registry().get(layerId);
  if (!entry || entry.progress.steps[step] === state) return;
  entry.progress = { ...entry.progress, activeAt: Date.now(), steps: { ...entry.progress.steps, [step]: state } };
  tell(entry);
}

/** The explanation so far. Listeners hear it at most every TEXT_EVERY_MS; the clock of activity moves at once. */
export function setText(layerId: string, text: string) {
  const entry = registry().get(layerId);
  if (!entry) return;
  entry.progress = { ...entry.progress, text, activeAt: Date.now() };
  if (entry.timer) return;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    tell(entry);
  }, TEXT_EVERY_MS);
}

/** Claude sent something for this layer (thinking, a section being fixed): the clock of activity moves; the page hears it within a couple of seconds. */
export function touch(layerId: string) {
  const entry = registry().get(layerId);
  if (!entry) return;
  entry.progress = { ...entry.progress, activeAt: Date.now() };
  if (entry.beat) return;
  entry.beat = setTimeout(() => {
    entry.beat = null;
    tell(entry);
  }, 2_000);
}

/** When anything last happened in this layer's writing (0 when it isn't being written). */
export const lastActivity = (layerId: string) => registry().get(layerId)?.progress.activeAt ?? 0;

export function finishProgress(layerId: string, outcome: NonNullable<LayerProgress["outcome"]>) {
  const entry = registry().get(layerId);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  if (entry.beat) clearTimeout(entry.beat);
  entry.progress = { ...entry.progress, outcome };
  tell(entry);
  entry.listeners.clear();
  registry().delete(layerId);
}

/** Follow a layer's progress: called at once with where it is now, then on every change, until it ends. Returns the unsubscribe. */
export function watchProgress(layerId: string, fn: (p: LayerProgress) => void): () => void {
  const entry = registry().get(layerId);
  if (!entry) return () => {};
  entry.listeners.add(fn);
  fn(entry.progress);
  return () => entry.listeners.delete(fn);
}
