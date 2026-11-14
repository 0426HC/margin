"use client";

import { useEffect } from "react";

// Projects whose conversation has changed since the Librarian last read it, in this browser.
const talked = new Set<string>();

/** Called when a message is sent from anywhere (the section or a layer). */
export const markTalked = (projectId: string) => void talked.add(projectId);

/** Ask the Librarian to collect sources, if there is something new. keepalive lets it outlive a page that is closing. */
export function findSources(projectId: string) {
  if (!talked.delete(projectId)) return;
  void fetch(`/api/projects/${projectId}/sources/find`, { method: "POST", keepalive: true }).catch(() => {});
}

/**
 * The Librarian collects sources when the student leaves Let's talk!: when this unmounts, when `active` turns off (the layer's
 * Let's talk! tab is switched away) and when the browser tab is closed. Nothing happens if nothing was said.
 */
export function useCollectOnLeave(projectId: string, active = true) {
  useEffect(() => {
    if (!active) return;
    const onHide = () => findSources(projectId);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      findSources(projectId);
    };
  }, [projectId, active]);
}
