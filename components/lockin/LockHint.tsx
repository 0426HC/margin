"use client";

import { useSyncExternalStore } from "react";
import { HINT_KEY, MODE_KEY } from "@/lib/lockin/keys";
import { dismissHint, readStored, subscribeHint } from "@/lib/lockin/store";

// Seen once the student says "Got it" or uses the switch (setLockIn stores both keys). Never on the server, so the page as sent has no hint.
const seen = () => readStored(HINT_KEY) === "1" || readStored(MODE_KEY) !== null;

/** The first time a student ever opens Margin: a small note under the Lock in switch. "Got it" (or using the switch) and it never comes back. */
export function LockHint() {
  const show = !useSyncExternalStore(subscribeHint, seen, () => true);
  if (!show) return null;
  return (
    <div className="lk-hint" role="note" aria-label="New: Lock in">
      <p>
        <b>New: Lock in.</b> Turn off the visuals when you need to focus.
      </p>
      <button type="button" className="lk-btn lk-btn-primary" onClick={dismissHint}>
        Got it
      </button>
    </div>
  );
}
