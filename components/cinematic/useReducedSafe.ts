"use client";

/* eslint-disable react-hooks/set-state-in-effect -- false on the first render so server and client HTML match, then the real value */

import { useReducedMotion } from "motion/react";
import { useLayoutEffect, useState } from "react";

/** useReducedMotion, but false on the first render so server and client HTML match. */
export function useReducedSafe() {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useLayoutEffect(() => setMounted(true), []);
  return mounted ? Boolean(reduced) : false;
}
