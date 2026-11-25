"use client";

import { setLockIn, useLockIn } from "@/lib/lockin/store";

/**
 * The Lock in switch: a pill with its label and a small switch. On, it reads "Locked in" with a plum dot and the switch turns plum.
 * Its accessible name is the visible label, so someone using voice control can say what they see.
 */
export function LockSwitch() {
  const on = useLockIn();
  return (
    <button type="button" role="switch" aria-checked={on} className="lk-pill lk-switch" data-lockin-switch="" onClick={() => setLockIn(!on)}>
      {on && <i className="lk-dot" aria-hidden="true" />}
      <span className="lk-label">{on ? "Locked in" : "Lock in"}</span>
      <span className="lk-track" aria-hidden="true">
        <span className="lk-knob" />
      </span>
    </button>
  );
}
