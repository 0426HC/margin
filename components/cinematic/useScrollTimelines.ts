"use client";

import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/**
 * Whether the browser plays CSS animations on scroll timelines (the course page's scenes move that way). True in the server HTML and on
 * the first render, so nothing changes for the browsers Margin runs in (Chrome); a browser without them gets the plain page.
 */
export function useScrollTimelines(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => typeof CSS !== "undefined" && CSS.supports("animation-timeline: view()"),
    () => true,
  );
}
