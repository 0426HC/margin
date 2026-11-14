import { STATE_WORD, type LayerState } from "@/lib/layers/progress";

/** A layer's progress as a small mark that reads without colour: hollow ring = not saved, filled = saved to Note to Self. */
export function LayerMark({ state, withLabel = false }: { state: LayerState; withLabel?: boolean }) {
  const status = state === "saved" ? "solid" : "new";
  return (
    <span className="m-mark" data-status={status} role="img" aria-label={STATE_WORD[state]}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
        {state === "saved" && <circle cx="6" cy="6" r="4.6" fill="currentColor" />}
      </svg>
      {withLabel && <span className="m-mark-label">{STATE_WORD[state]}</span>}
    </span>
  );
}
