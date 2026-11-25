"use client";

import { useInView } from "motion/react";
import { useRef, type ReactNode } from "react";
import { SceneLive } from "@/components/art/live";
import { useRevealOnce } from "@/components/cinematic/useRevealOnce";
import "@/components/art/art.css";

/**
 * One overview scene beside the weeks (Let's talk!, Lecture notes, the exam room, Note to Self). About one screen tall and scrolled freely:
 * nothing pins and nothing snaps. On the left a small mono eyebrow, the big title, one sentence, a mono status line and (optionally) one
 * button; on the right the illustration. The first time the scene comes into view it fades in and rises a little (once, transform and
 * opacity, CSS). Under reduced motion it only fades. The scene is visible as sent: it is hidden for its reveal only once scripts run
 * (useRevealOnce), so it can never be left invisible. Its illustration learns through `SceneLive` whether the scene is on screen.
 */
export function StoryScene({
  id,
  eyebrow,
  title,
  why,
  status,
  action,
  art,
  reduced,
  sceneRef,
  enter = false,
}: {
  id: string;
  eyebrow: string;
  title: string;
  why: string;
  status: ReactNode;
  action?: ReactNode;
  /** A memoised illustration: it never re-renders while scrolling. */
  art: ReactNode;
  reduced: boolean;
  sceneRef: (el: HTMLElement | null) => void;
  /** Just shown by a tab switch: play the entrance even though it is already on screen. */
  enter?: boolean;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const live = useInView(ref, { margin: "0px 0px -15% 0px" });
  const reveal = useRevealOnce(ref, 0.25, enter);
  return (
    <section
      className="ov-free"
      data-reveal={reveal === "static" ? undefined : reveal}
      data-flat={reduced ? "" : undefined}
      data-live={live ? "" : undefined}
      aria-labelledby={`${id}-h`}
      ref={(el) => {
        ref.current = el;
        sceneRef(el);
      }}
    >
      <div className="ov-free-stage">
        <div className="ov-free-text">
          <p className="ov-kicker">{eyebrow}</p>
          <h2 id={`${id}-h`} className="ov-title ov-free-title">
            {title}
          </h2>
          <div className="ov-free-rest">
            <p className="ov-free-why">{why}</p>
            <p className="ov-free-status">{status}</p>
            {action}
          </div>
        </div>
        <div className="ov-free-art">
          <SceneLive.Provider value={live}>{art}</SceneLive.Provider>
        </div>
      </div>
    </section>
  );
}
