"use client";

import { useEffect, useState } from "react";
import { weeksPhrase } from "@/lib/brain/words";
import type { WritingStatus } from "@/lib/layers/background";

const EVERY_MS = 15_000;

/**
 * "Knows Weeks 1-4 so far": one quiet line at the top of Let's talk! while the course brain is still reading the course, so the student
 * knows which weeks an answer can draw on fully. Gone once every week is read.
 */
export function BrainKnows({ projectId }: { projectId: string }) {
  const [brain, setBrain] = useState<WritingStatus["brain"] | null>(null);
  useEffect(() => {
    let stop = false;
    const look = () =>
      fetch(`/api/projects/${projectId}/writing`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<WritingStatus>) : null))
        .then((s) => !stop && s && setBrain(s.brain))
        .catch(() => undefined);
    void look();
    const t = window.setInterval(() => document.visibilityState === "visible" && void look(), EVERY_MS);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [projectId]);
  if (!brain?.building || !brain.weeksTotal) return null;
  return (
    <p className="m-brain-knows" role="status">
      {brain.readWeeks.length ? `Knows ${weeksPhrase(brain.readWeeks)} so far` : "Still reading the course"}
    </p>
  );
}
