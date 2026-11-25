"use client";

import { useEffect, useState } from "react";
import type { WritingStatus } from "@/lib/layers/background";

const EVERY_MS = 5_000;

/**
 * What Margin is doing in the background, in the course page's top bar: "Margin has read 4 of 12 weeks" while the course brain reads the
 * course, and "12 of 18 layers ready" while layers are written. Quiet on purpose: one line of label type, no motion. While the plan's usage
 * limit holds it says when work starts again. Looks again every few seconds until everything is done; then the brain's line goes.
 */
export function BackgroundProgress({ projectId, initial }: { projectId: string; initial: WritingStatus }) {
  const [status, setStatus] = useState(initial);
  const reading = status.brain.building && status.brain.weeksTotal > 0;
  const done = status.ready >= status.total && !reading && !status.pausedUntil;
  useEffect(() => {
    if (done) return;
    const t = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      fetch(`/api/projects/${projectId}/writing`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<WritingStatus>) : null))
        .then((s) => s && setStatus((was) => (JSON.stringify(was) === JSON.stringify(s) ? was : s)))
        .catch(() => undefined);
    }, EVERY_MS);
    return () => window.clearInterval(t);
  }, [projectId, done]);
  if (!status.total && !reading) return null;
  const { weeksRead, weeksTotal } = status.brain;
  return (
    <span className="ov-bar-ready" role="status">
      {reading && (
        <span className="ov-bar-brain">
          <span className="ov-bar-wide">Margin has read</span>
          <span className="ov-bar-narrow">Read</span> {weeksRead} of {weeksTotal} {weeksTotal === 1 ? "week" : "weeks"}
        </span>
      )}
      {reading && status.total > 0 && " · "}
      {status.total > 0 && (
        <>
          {status.ready} of {status.total} layers ready
        </>
      )}
      {status.pausedUntil && <span className="ov-bar-paused"> · paused until {status.pausedUntil}, when your Claude usage limit resets</span>}
    </span>
  );
}
