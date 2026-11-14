"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useLayoutEffect, useRef } from "react";
import { splitCitations } from "@/lib/ai/citations";
import type { ExplainedLayer } from "@/lib/ai/schemas";
import type { SourceQuote } from "@/lib/db/schema";
import type { CiteHandler } from "@/components/ui/Citation";
import { Segmented } from "@/components/ui/Segmented";
import { MarginRow, type MarginMark } from "@/components/workspace/MarginGutter";

export type LayerTab = "explained" | "source";
export const citeKey = (file: string, page: number) => `${file}\u0000${page}`;
const ease = [0.23, 1, 0.32, 1] as const;

/** The text of a block with its [file, p. N] citations lifted out, so they can sit in the margin instead. */
function liftCitations(text: string) {
  const cites = new Map<string, { file: string; page: number }>();
  const body = splitCitations(text)
    .map((p) => {
      if ("text" in p) return p.text;
      cites.set(citeKey(p.cite.file, p.cite.page), { file: p.cite.file, page: p.cite.page });
      return "";
    })
    .join("")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  return { body, cites: [...cites.values()] };
}

/** Shared enter and exit for the two tabs: opacity plus a few px of travel, nothing else. */
function useSwap() {
  const reduced = useReducedMotion();
  return {
    initial: { opacity: 0, y: reduced ? 0 : 6 },
    animate: { opacity: 1, y: 0, transition: { duration: reduced ? 0.12 : 0.2, ease } },
    exit: { opacity: 0, y: 0, transition: { duration: reduced ? 0.08 : 0.1, ease: "easeOut" as const } },
  };
}

function ExplainedView({ explained, onCite, onMounted }: { explained: ExplainedLayer; onCite: CiteHandler; onMounted: () => void }) {
  const swap = useSwap();
  useLayoutEffect(onMounted, [onMounted]);
  const marksOf = (cites: { file: string; page: number }[], near: string): MarginMark[] => cites.map((c) => ({ kind: "cite", page: c.page, file: c.file, onJump: onCite, near }));
  return (
    <motion.div {...swap} id="reading-panel" role="tabpanel" aria-labelledby="layer-view-explained" className="m-explained">
      {explained.blocks.map((b, i) => {
        if (b.type === "heading") {
          return (
            <MarginRow key={i} kind="title" marks={[]}>
              <h3>{b.text}</h3>
            </MarginRow>
          );
        }
        if (b.type === "paragraph") {
          const { body, cites } = liftCitations(b.text);
          return (
            <MarginRow key={i} marks={marksOf(cites, body)}>
              <p>{body}</p>
            </MarginRow>
          );
        }
        if (b.type === "bullets") {
          const lifted = b.items.map(liftCitations);
          const cites = [...new Map(lifted.flatMap((l) => l.cites).map((c) => [citeKey(c.file, c.page), c])).values()];
          return (
            <MarginRow key={i} marks={marksOf(cites, lifted.map((l) => l.body).join(" "))}>
              <ul>
                {lifted.map((l, j) => (
                  <li key={j}>{l.body}</li>
                ))}
              </ul>
            </MarginRow>
          );
        }
        const { cites } = liftCitations(b.source);
        return (
          <MarginRow key={i} marks={marksOf(cites, `${b.caption} ${b.rows.flat().join(" ")}`)}>
            <table>
              <caption>{b.caption}</caption>
              <thead>
                <tr>
                  {b.columns.map((c) => (
                    <th key={c} scope="col">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j}>
                    {r.map((cell, k) => (
                      <td key={k}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </MarginRow>
        );
      })}
      <MarginRow marks={[]}>
        <div className="m-sowhat">
          <p className="m-sowhat-label">So what</p>
          <p>{explained.soWhat}</p>
        </div>
      </MarginRow>
    </motion.div>
  );
}

/** The exact text the explanation rests on: verbatim, with its paragraphs, headings and lists, and the file and page in the margin. */
function SourceView({ quotes, onMounted }: { quotes: SourceQuote[]; onMounted: () => void }) {
  const swap = useSwap();
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(onMounted, [onMounted]);
  const firstOfPage = quotes.map((q, i) => i === 0 || citeKey(quotes[i - 1].file, quotes[i - 1].page) !== citeKey(q.file, q.page));
  return (
    <motion.div {...swap} id="reading-panel" role="tabpanel" aria-labelledby="layer-view-source" ref={root}>
      {quotes.map((q, qi) => {
        const key = citeKey(q.file, q.page);
        const first = firstOfPage[qi];
        return (
          <div key={q.passageId} data-cite-key={key} data-page-first={first ? q.page : undefined} style={{ display: "contents" }}>
            <MarginRow marks={first ? [{ kind: "page", page: q.page, file: q.file }] : []}>
              {/* one element in the text column, however many blocks the quote has */}
              <div className="m-q">
                {q.blocks?.length ? (
                  q.blocks.map((b, i) => (b.kind === "heading" ? <h3 key={i} className="m-q-head">{b.text}</h3> : <p key={i} className={b.kind === "list" ? "m-q-list" : undefined}>{b.text}</p>))
                ) : (
                  <p>{q.text}</p>
                )}
              </div>
            </MarginRow>
          </div>
        );
      })}
    </motion.div>
  );
}

export function LayerReading({
  partLabel,
  title,
  bigQuestion,
  tab,
  onTab,
  explained,
  source,
  onCite,
  minutes,
  onScroll,
  restoreScroll,
  children,
}: {
  partLabel: string;
  title: string;
  bigQuestion: string;
  tab: LayerTab;
  onTab: (t: LayerTab) => void;
  explained: ExplainedLayer | null;
  source: SourceQuote[] | null;
  onCite: CiteHandler;
  minutes: number;
  onScroll: (top: number) => void;
  restoreScroll: (tab: LayerTab) => void;
  /** Shown instead of the tabs while the layer is being written, or when it can't be. */
  children?: React.ReactNode;
}) {
  const ready = explained && source;
  const mountedExplained = useCallback(() => restoreScroll("explained"), [restoreScroll]);
  const mountedSource = useCallback(() => restoreScroll("source"), [restoreScroll]);
  const sources = source ? new Set(source.map((q) => q.file)).size : 0;
  return (
    <section className="m-paper m-reading-pane" aria-label={title}>
      <div className="m-scroll" onScroll={(e) => onScroll(e.currentTarget.scrollTop)}>
        <div className="m-reading">
          <header className="m-head">
            <p className="m-part-tag">{partLabel}</p>
            <h1 className="t-h1">{title}</h1>
            <p className="m-subtitle">{bigQuestion}</p>
            {ready && (
              <p className="m-source">
                <span>
                  {source.length} {source.length === 1 ? "passage" : "passages"} from {sources} {sources === 1 ? "file" : "files"}
                </span>
                <span>about {minutes} min</span>
              </p>
            )}
          </header>
          {children}
          {ready && (
            <>
              <div className="m-bar">
                <Segmented
                  label="Show this layer as"
                  idPrefix="layer-view"
                  panelId="reading-panel"
                  value={tab}
                  onChange={onTab}
                  options={[
                    { value: "explained", label: "Explained" },
                    { value: "source", label: "Source" },
                  ]}
                />
                <p className="m-bar-note" aria-live="polite">
                  {tab === "explained" ? "In plain English. Each page number in the margin jumps to the source." : "The exact text from your files, with its file and page."}
                </p>
              </div>
              <div className="m-body">
                <AnimatePresence mode="wait" initial={false}>
                  {tab === "explained" ? <ExplainedView key="explained" explained={explained} onCite={onCite} onMounted={mountedExplained} /> : <SourceView key="source" quotes={source} onMounted={mountedSource} />}
                </AnimatePresence>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
