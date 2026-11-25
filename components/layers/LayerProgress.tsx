"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { STEP_WORDS, spanWords, type LayerProgress as Progress, type LayerStep } from "@/lib/layers/layer-progress";

/** How long writing a layer normally takes, said plainly. Measured on real course layers of up to about 10,000 words of reading (Opus 5.5, medium effort). */
export const FIRST_WORDS = "about 10 seconds";
export const WHOLE_LAYER = "about a minute and a half";

const WORD: Record<Progress["steps"][LayerStep], string> = { waiting: "Waiting", working: "Working", done: "Done" };
const KEPT: Record<LayerStep, string> = { source: "the passages chosen from your files", explained: "the explanation", check: "" };

export const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
};

/**
 * While a layer is being written. Before its first words arrive: the steps in plain words, each with a mark and a word (Done, Working,
 * Waiting), and the time so far. Once they arrive (`reading`), one quiet line above the text, which grows below it as it is written.
 * Calm on purpose: nothing moves but the clock. Margin stops only when nothing new arrives for a while, and then says so.
 */
export function LayerProgress({ progress, skew, reading }: { progress: Progress | null; /** server clock minus this one */ skew: number; reading: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const elapsed = progress ? now + skew - progress.startedAt : 0;
  const quiet = progress ? now + skew - progress.activeAt : 0;
  const stalled = progress && quiet > 60_000 ? <> Nothing new has come for {clock(quiet)}; Margin waits up to {spanWords(progress.idleMs)}, then tells you what happened.</> : null;
  if (reading && progress) {
    const checking = progress.steps.explained === "done";
    return (
      <p className="m-writing-line" role="status" aria-live="polite">
        {checking ? "Checking every citation and named idea against your files" : "Writing this layer; the rest appears as it is written"} · {clock(elapsed)} so far.{stalled}
      </p>
    );
  }
  return (
    <div className="m-note m-progress" role="status" aria-live="polite">
      <p className="m-progress-head">Writing this layer. The first words appear in {FIRST_WORDS} and the whole layer takes {WHOLE_LAYER}; after that it opens at once.</p>
      <ol className="m-progress-steps">
        {STEP_WORDS.map(({ step, label }) => {
          const state = progress?.steps[step] ?? "waiting";
          return (
            <li key={step} data-state={state}>
              <i aria-hidden="true" />
              <span>{label}</span>
              <span className="m-progress-word">{WORD[state]}</span>
            </li>
          );
        })}
      </ol>
      {progress && (
        <p className="m-progress-time">
          {clock(elapsed)} so far.{stalled}
        </p>
      )}
    </div>
  );
}

/** Writing the layer stopped: what happened, what was kept, and Try again. */
export function LayerFailed({ message, kept, onRetry }: { message: string; kept: LayerStep[]; onRetry: () => void }) {
  const keptWords = kept.map((k) => KEPT[k]).filter(Boolean);
  return (
    <div className="m-note m-progress" role="alert">
      <p className="m-progress-error">{message}</p>
      {keptWords.length > 0 && <p>Already finished and kept: {keptWords.join(" and ")}. Try again only writes what is missing.</p>}
      <Button variant="accent" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
