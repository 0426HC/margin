"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { MasteryMark, type Status } from "@/components/ui/MasteryMark";
import { MarginRow } from "./MarginGutter";
import { ViewToggle, type ViewMode } from "./ViewToggle";

export type OriginalBlock = { kind: "title" | "subtitle" | "dateline" | "byline" | "salutation" | "p"; text: string; page: number };
export type ExplainedPara = { text: string; pages: number[] };

const ease = [0.23, 1, 0.32, 1] as const;

/** Shared enter/exit for the two views: opacity plus a few px of travel, nothing else. */
function useSwap() {
  const reduced = useReducedMotion();
  return {
    initial: { opacity: 0, y: reduced ? 0 : 6 },
    animate: { opacity: 1, y: 0, transition: { duration: reduced ? 0.12 : 0.2, ease } },
    exit: { opacity: 0, y: 0, transition: { duration: reduced ? 0.08 : 0.1, ease: "easeOut" as const } },
  };
}

/** The file's exact text, with page markers in the margin. Never rewritten. */
export function OriginalView({ blocks, flashPage }: { blocks: OriginalBlock[]; flashPage?: number | null }) {
  const swap = useSwap();
  return (
    <motion.div {...swap} id="reading-panel" role="tabpanel" aria-labelledby="view-original">
      {blocks.map((b, i) => {
        const first = i === 0 || blocks[i - 1].page !== b.page;
        return (
          <MarginRow key={i} kind={b.kind} marks={first ? [{ kind: "page", page: b.page }] : []} firstOnPage={first ? b.page : undefined} flash={flashPage === b.page}>
            {b.kind === "title" ? <h3>{b.text}</h3> : <p>{b.text}</p>}
          </MarginRow>
        );
      })}
    </motion.div>
  );
}

/** A plain-English walkthrough. Each citation sits in the margin and jumps to the page in Original. */
export function ExplainedView({ paras, file, onCite }: { paras: ExplainedPara[]; file: string; onCite: (page: number) => void }) {
  const swap = useSwap();
  return (
    <motion.div {...swap} id="reading-panel" role="tabpanel" aria-labelledby="view-explained">
      {paras.map((p, i) => (
        <MarginRow key={i} marks={p.pages.map((page) => ({ kind: "cite" as const, page, file, onJump: onCite }))}>
          <p>{p.text}</p>
        </MarginRow>
      ))}
    </motion.div>
  );
}

/**
 * The reading pane: a sheet of manila paper. Title, source, the Why-it-matters box, then the
 * Original | Explained toggle. It is controlled: the page decides which view is showing.
 */
export function ReadingPane({
  title,
  subtitle,
  source,
  minutes,
  status,
  why,
  mode,
  onModeChange,
  original,
  explained,
  file,
  flashPage,
  onCite,
}: {
  title: string;
  subtitle?: string;
  source: string;
  minutes: number;
  status: Status;
  why: string;
  mode: ViewMode;
  onModeChange: (m: ViewMode) => void;
  original: OriginalBlock[];
  explained: ExplainedPara[];
  file: string;
  flashPage?: number | null;
  onCite: (page: number) => void;
}) {
  return (
    <section className="m-paper m-reading-pane" aria-label={title}>
      <div className="m-scroll">
        <div className="m-reading">
          <header className="m-head">
            <h1 className="t-h1">{title}</h1>
            {subtitle && <p className="m-subtitle">{subtitle}</p>}
            <p className="m-source">
              <span>{source}</span>
              <span>about {minutes} min</span>
              <MasteryMark status={status} withLabel />
            </p>
            <aside className="m-why" aria-labelledby="why-h">
              <h2 id="why-h">Why this section matters</h2>
              <p>{why}</p>
            </aside>
          </header>
          <div className="m-bar">
            <ViewToggle value={mode} onChange={onModeChange} panelId="reading-panel" />
            <p className="m-bar-note" aria-live="polite">
              {mode === "original" ? "The exact text from your file." : "In plain English. Every page number jumps to the original."}
            </p>
          </div>
          <div className="m-body">
            <AnimatePresence mode="wait" initial={false}>
              {mode === "original" ? (
                <OriginalView key="original" blocks={original} flashPage={flashPage} />
              ) : (
                <ExplainedView key="explained" paras={explained} file={file} onCite={onCite} />
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
