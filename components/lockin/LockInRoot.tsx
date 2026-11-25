"use client";

import { MotionConfig } from "motion/react";
import { useEffect } from "react";
import { noteClickedLink } from "@/lib/layers/frame-peek";
import { useLockIn } from "@/lib/lockin/store";
import { useTimerDriver } from "@/lib/lockin/timerStore";
import { StopwatchNote } from "./StopwatchNote";
import { FocusModality } from "@/components/ui/FocusModality";

/**
 * Wraps every page: in lock in, Motion's transform animations are off (opacity still fades, so nothing pops). Drives the focus timer, and
 * holds the stopwatch's note. Also notes which layer a clicked link opens, before the route changes, so its frame shows at once
 * (`lib/layers/frame-peek.ts`).
 */
export function LockInRoot({ children }: { children: React.ReactNode }) {
  const on = useLockIn();
  useTimerDriver();
  useEffect(() => {
    document.addEventListener("click", noteClickedLink, true);
    return () => document.removeEventListener("click", noteClickedLink, true);
  }, []);
  return (
    <MotionConfig reducedMotion={on ? "always" : "user"}>
      {children}
      <StopwatchNote />
      <FocusModality />
    </MotionConfig>
  );
}
