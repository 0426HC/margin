"use client";

import { useLockIn } from "@/lib/lockin/store";
import { FocusTimer } from "./FocusTimer";
import { HeldUpdates } from "./HeldUpdates";
import { LockHint } from "./LockHint";
import { LockSwitch } from "./LockSwitch";

/** What every top bar carries on its right: the Lock in switch and, in lock in, any held agent updates and the focus timer. */
export function LockControls() {
  const on = useLockIn();
  return (
    <span className="lk-controls">
      {on && <HeldUpdates />}
      {on && <FocusTimer />}
      <LockSwitch />
      <LockHint />
    </span>
  );
}
