"use client";

import { animate, useMotionValue } from "motion/react";
import Link from "next/link";
import { LockControls } from "@/components/lockin/LockControls";
import { useLockIn } from "@/lib/lockin/store";
import { useEffect, useMemo } from "react";
import { Body } from "./Agents";
import { AGENTS, type AgentId } from "./agentState";
import { Backdrop } from "./Backdrop";
import { unitAccents, unitMotifs } from "./theme";
import { useReducedSafe } from "./useReducedSafe";
import "./overview.css";
import "./stage.css";

/**
 * The shared shell for the screens that sit outside the workspace but are not the overview: the same desk,
 * the same seeded generative backdrop, the same top bar. `at` moves the backdrop between its looks (0 to count - 1).
 */
export function Stage({
  seed,
  count = 3,
  at = 0,
  course,
  back,
  action,
  children,
}: {
  seed: string;
  count?: number;
  at?: number;
  course?: string;
  /** a section page's way back to its course, shown top left in place of the wordmark and the course name */
  back?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const reduced = useReducedSafe();
  const locked = useLockIn(); // lock in: nothing drawn behind the page
  const accents = useMemo(() => unitAccents(seed, Math.max(count, 2)), [seed, count]);
  const motifs = useMemo(() => unitMotifs(seed, Math.max(count, 2)), [seed, count]);
  const pos = useMotionValue(at);
  useEffect(() => {
    if (reduced) {
      pos.set(at);
      return;
    }
    const controls = animate(pos, at, { duration: 1.4, ease: [0.23, 1, 0.32, 1] });
    return () => controls.stop();
  }, [at, reduced, pos]);

  return (
    <div className="ov st" style={{ ["--unit" as string]: `rgb(${accents[0].join(" ")})` }}>
      {!locked && <Backdrop seed={seed} accents={accents} motifs={motifs} pos={pos} reduced={reduced} />}
      <header className="ov-bar-top">
        {back ?? (
          <>
            <Link href="/" className="ov-wordmark" aria-label="Margin, back to your projects">
              Margin.
            </Link>
            {course && <span className="ov-bar-course">{course}</span>}
          </>
        )}
        {action}
        <LockControls />
      </header>
      {children}
    </div>
  );
}

/** One of the five agents, standing. Colour is their identity; the shape does the rest. */
export function AgentFigure({ id, size = 56, mood }: { id: AgentId; size?: number; mood?: "idle" | "eager" | "busy" }) {
  const agent = AGENTS.find((a) => a.id === id)!;
  return (
    <span className="st-agent" data-mood={mood ?? "idle"} style={{ ["--c" as string]: agent.color, width: size, height: (size * 46) / 40 }}>
      <svg viewBox="0 0 40 46" width={size} height={(size * 46) / 40} aria-hidden="true">
        <Body id={id} />
      </svg>
    </span>
  );
}
