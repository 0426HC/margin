"use client";

import { motion, useReducedMotion } from "motion/react";
import { useRef } from "react";
import { FILE, type ExplainedPara, type OriginalBlock } from "./data";

const ease = [0.23, 1, 0.32, 1] as const;

/** Shared enter/exit for the two views. Opacity plus a few px of travel, nothing else. */
function useSwap() {
  const reduced = useReducedMotion();
  return {
    initial: { opacity: 0, y: reduced ? 0 : 6 },
    animate: { opacity: 1, y: 0, transition: { duration: reduced ? 0.12 : 0.2, ease } },
    exit: { opacity: 0, y: 0, transition: { duration: reduced ? 0.08 : 0.1, ease: "easeOut" as const } },
  };
}

/** Motion can report an animation start more than once per mount; the parent should hear it once. */
function useOnce(fn: () => void) {
  const done = useRef(false);
  return () => {
    if (done.current) return;
    done.current = true;
    fn();
  };
}

export function OriginalView({
  blocks,
  flash,
  onEnter,
}: {
  blocks: OriginalBlock[];
  flash: { page: number; n: number } | null;
  onEnter: () => void;
}) {
  const swap = useSwap();
  const entered = useOnce(onEnter);
  let lastPage = -1;
  return (
    <motion.div {...swap} onAnimationStart={entered} className="view" id="reading-panel" role="tabpanel" aria-labelledby="tab-original">
      {blocks.map((b, i) => {
        const first = b.page !== lastPage;
        lastPage = b.page;
        const flashing = flash?.page === b.page;
        return (
          <div
            className={`row kind-${b.kind}`}
            key={`${i}-${flashing ? flash.n : 0}`}
            data-page-first={first ? b.page : undefined}
            data-flash={flashing ? "" : undefined}
          >
            <div className="gutter">
              {first && (
                <span className="page-marker">
                  <span>p. {b.page}</span>
                </span>
              )}
            </div>
            {b.kind === "title" ? <h3>{b.text}</h3> : <p>{b.text}</p>}
          </div>
        );
      })}
    </motion.div>
  );
}

export function ExplainedView({
  paras,
  onCite,
  onEnter,
}: {
  paras: ExplainedPara[];
  onCite: (page: number) => void;
  onEnter: () => void;
}) {
  const swap = useSwap();
  const entered = useOnce(onEnter);
  return (
    <motion.div {...swap} onAnimationStart={entered} className="view explained" id="reading-panel" role="tabpanel" aria-labelledby="tab-explained">
      {paras.map((p, i) => (
        <div className="row" key={i}>
          <div className="gutter">
            {p.pages.map((pg) => (
              <button
                type="button"
                key={pg}
                className="cite"
                onClick={() => onCite(pg)}
                aria-label={`[${FILE}, p. ${pg}]. Show this page in the original`}
                title={`${FILE}, p. ${pg}`}
              >
                <span>p. {pg}</span>
              </button>
            ))}
          </div>
          <p>{p.text}</p>
        </div>
      ))}
    </motion.div>
  );
}
