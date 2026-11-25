"use client";

import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/**
 * False in the server HTML and while React takes over the page, true once it has. Anything that would start hidden waits for this, so
 * the page as sent is always readable: if scripts run late or fail, nothing stays invisible.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}
