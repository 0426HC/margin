"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import { useHydrated } from "./useHydrated";

/**
 * A one-time reveal that can only add to what is already there. The element is visible as sent; only once the page's scripts run, and only
 * if it is still below the fold, is it put into its "armed" (hidden) state, and it is "shown" the first time it comes into view. Without
 * scripts, or without IntersectionObserver, it simply stays visible. `enter` arms it even on screen: a scene shown by switching tabs.
 */
export function useRevealOnce(ref: RefObject<HTMLElement | null>, amount = 0.25, enter = false): "static" | "armed" | "shown" {
  const hydrated = useHydrated();
  const [state, setState] = useState<"static" | "armed" | "shown">("static");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!hydrated || !el || typeof IntersectionObserver === "undefined") return;
    // already on screen: leave it be, unless it has just been brought in (a tab switch), when it plays its entrance as if scrolled into view
    if (!enter && el.getBoundingClientRect().top < window.innerHeight * 0.9) return;
    setState("armed");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setState("shown");
          io.disconnect();
        }
      },
      { threshold: amount },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hydrated, ref, amount, enter]);
  return state;
}
