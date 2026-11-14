import type { Status } from "./data";

const names: Record<Status, string> = { new: "New", shaky: "Shaky", solid: "Solid" };

/** A small mark, readable without colour: ring = new, half = shaky, filled = solid. */
export function MasteryMark({ status, withLabel = false }: { status: Status; withLabel?: boolean }) {
  return (
    <span className="mark" data-status={status} role="img" aria-label={names[status]}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
        {status === "solid" && <circle cx="6" cy="6" r="4.6" fill="currentColor" />}
        {status === "shaky" && <path d="M6 1.4a4.6 4.6 0 0 0 0 9.2z" fill="currentColor" />}
      </svg>
      {withLabel && <span className="mark-label">{names[status]}</span>}
    </span>
  );
}
