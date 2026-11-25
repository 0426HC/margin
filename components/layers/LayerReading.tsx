"use client";

import type { OptionalQuote } from "@/lib/layers/types";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { isExplainedV2, type ExplainedBlock, type ExplainedLayer, type ExplainedSectionBlock } from "@/lib/ai/schemas";
import type { ExplainedDraft } from "@/lib/layers/explained-text";
import { foldLoneCitations } from "@/lib/layers/explained-check";
import type { SourceQuote } from "@/lib/db/schema";
import type { CiteHandler } from "@/components/ui/Citation";
import { Segmented } from "@/components/ui/Segmented";
import { MarginRow, type MarginMark } from "@/components/workspace/MarginGutter";
import type { LectureTab } from "@/lib/lecture/service";
import { LectureView, type LectureStatus } from "./LectureView";
import { FullReadingSwitch, FullReadingView } from "./FullReading";
import { citeKey, liftCitations, useSwap, type LayerTab } from "./reading-parts";

/** "Going further": the optional readings attached to this layer, named and paged. Written by code, so it says only what is true. */
function goingFurther(optional: OptionalQuote[]): string | null {
  const files = [...new Map(optional.map((q) => [q.file, optional.filter((x) => x.file === q.file).map((x) => x.page)])).entries()];
  if (!files.length) return null;
  const name = ([file, pages]: [string, number[]]) => {
    const lo = Math.min(...pages);
    const hi = Math.max(...pages);
    return `“${file.replace(/\.[a-z0-9]{1,5}$/i, "")}” (${lo === hi ? `p. ${lo}` : `pp. ${lo}–${hi}`})`;
  };
  const list = files.map(name);
  const joined = list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  return `To go further, the optional ${list.length === 1 ? "reading" : "readings"} ${joined} ${list.length === 1 ? "takes" : "take"} this topic further. ${list.length === 1 ? "It is" : "They are"} optional: the passages are at the end of Source.`;
}

type Marks = (cites: { file: string; page: number }[], near: string) => MarginMark[];

/** One block of explanation (a paragraph, a list or a table) with its citations lifted into the margin. */
function BlockRow({ b, marksOf }: { b: ExplainedBlock | ExplainedSectionBlock; marksOf: Marks }) {
  if (b.type === "heading")
    return (
      <MarginRow kind="title" marks={[]}>
        <h3>{b.text}</h3>
      </MarginRow>
    );
  if (b.type === "paragraph") {
    const { body, cites } = liftCitations(b.text);
    return (
      <MarginRow marks={marksOf(cites, body)}>
        <p>{body}</p>
      </MarginRow>
    );
  }
  if (b.type === "bullets") {
    const lifted = b.items.map(liftCitations);
    const cites = [...new Map(lifted.flatMap((l) => l.cites).map((c) => [citeKey(c.file, c.page), c])).values()];
    return (
      <MarginRow marks={marksOf(cites, lifted.map((l) => l.body).join(" "))}>
        <ul>
          {lifted.map((l, j) => (
            <li key={j}>{l.body}</li>
          ))}
        </ul>
      </MarginRow>
    );
  }
  const rows = b.rows.map((r) => r.map(liftCitations));
  const cites = [...new Map([...liftCitations(b.source).cites, ...rows.flat().flatMap((c) => c.cites)].map((c) => [citeKey(c.file, c.page), c])).values()];
  return (
    <MarginRow marks={marksOf(cites, `${b.caption} ${b.rows.flat().join(" ")}`)}>
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
          {rows.map((r, j) => (
            <tr key={j}>
              {r.map((cell, k) => (
                <td key={k}>{cell.body}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </MarginRow>
  );
}

/** The Explained tab. `writing`: the explanation as it arrives, before the tabs exist, so it is not a tab panel yet. */
export function ExplainedView({ explained, optional, onCite, onMounted, writing = false }: { explained: ExplainedLayer; optional: OptionalQuote[]; onCite: CiteHandler; onMounted: () => void; writing?: boolean }) {
  const swap = useSwap();
  useLayoutEffect(onMounted, [onMounted]);
  const marksOf: Marks = (cites, near) => cites.map((c) => ({ kind: "cite", page: c.page, file: c.file, onJump: onCite, near }));
  return (
    <motion.div {...swap} {...(writing ? {} : { id: "reading-panel", role: "tabpanel", "aria-labelledby": "layer-view-explained" })} className="m-explained">
      {explained.summary && (
        <MarginRow marks={[]}>
          <section className="m-summary" aria-label="Summary">
            <p className="m-sowhat-label">Summary</p>
            <p>{explained.summary}</p>
          </section>
        </MarginRow>
      )}
      {isExplainedV2(explained) ? (
        <>
          <MarginRow marks={[]}>
            <section className="m-bigq" aria-label="The big question">
              <p className="m-sowhat-label">The big question</p>
              <p>{explained.question}</p>
            </section>
          </MarginRow>
          {explained.sections.map((sec, i) => (
            <section key={i} className="m-section" aria-labelledby={`sec-${i}`}>
              <MarginRow kind="title" marks={[]}>
                <h3 id={`sec-${i}`}>{sec.question}</h3>
              </MarginRow>
              {foldLoneCitations(sec.blocks).map((b, j) => (
                <BlockRow key={j} b={b} marksOf={marksOf} />
              ))}
            </section>
          ))}
        </>
      ) : (
        foldLoneCitations(explained.blocks).map((b, i) => <BlockRow key={i} b={b} marksOf={marksOf} />)
      )}
      {explained.soWhat && (
        <MarginRow marks={[]}>
          <div className="m-sowhat">
            <p className="m-sowhat-label">So what</p>
            <p>{liftCitations(explained.soWhat).body}</p>
          </div>
        </MarginRow>
      )}
      {goingFurther(optional) && (
        <MarginRow marks={[]}>
          <div className="m-further">
            <p className="m-sowhat-label">Going further</p>
            <p>{goingFurther(optional)}</p>
          </div>
        </MarginRow>
      )}
    </motion.div>
  );
}

/**
 * The exact text the explanation rests on: verbatim, with its paragraphs, headings and lists, and the file and page in the margin.
 * "Show full reading" swaps it for any whole reading or lecture file of the week, with this layer's passages marked.
 */
function SourceView({ layerId, quotes, optional, onMounted }: { layerId: string; quotes: SourceQuote[]; optional: OptionalQuote[]; onMounted: () => void }) {
  const swap = useSwap();
  const root = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  useLayoutEffect(onMounted, [onMounted]);
  const firstOfPage = quotes.map((q, i) => i === 0 || citeKey(quotes[i - 1].file, quotes[i - 1].page) !== citeKey(q.file, q.page));
  return (
    <motion.div {...swap} id="reading-panel" role="tabpanel" aria-labelledby="layer-view-source" ref={root}>
      <MarginRow marks={[]}>
        <FullReadingSwitch on={full} onChange={setFull} />
      </MarginRow>
      {full ? <FullReadingView layerId={layerId} onMounted={onMounted} /> : <>
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
      {optional.map((q, i) => (
        <div key={`opt:${q.passageId}`} data-cite-key={citeKey(q.file, q.page)} style={{ display: "contents" }}>
          <MarginRow marks={[{ kind: "page", page: q.page, file: q.file }]}>
            <div className="m-q m-q-optional">
              {i === 0 || optional[i - 1].file !== q.file ? <p className="m-q-optional-label">Optional reading</p> : null}
              <p>{q.text}</p>
            </div>
          </MarginRow>
        </div>
      ))}
      </>}
    </motion.div>
  );
}

export function LayerReading({
  projectId,
  layerId,
  lecture,
  lectureStatus,
  onAddFiles,
  onRetryLecture,
  partLabel,
  title,
  bigQuestion,
  tab,
  onTab,
  explained,
  draft,
  source,
  optional = [],
  onCite,
  minutes,
  onScroll,
  restoreScroll,
  children,
}: {
  projectId: string;
  layerId: string;
  lecture: LectureTab;
  lectureStatus: LectureStatus;
  onAddFiles: () => void;
  onRetryLecture: () => void;
  partLabel: string;
  title: string;
  bigQuestion: string;
  tab: LayerTab;
  onTab: (t: LayerTab) => void;
  explained: ExplainedLayer | null;
  /** While the layer is written: the explanation so far, shown as it arrives. */
  draft?: ExplainedDraft | null;
  source: SourceQuote[] | null;
  /** Optional readings attached to this layer, shown at the end of Source and named in "Going further". */
  optional?: OptionalQuote[];
  onCite: CiteHandler;
  minutes: number;
  onScroll: (top: number) => void;
  restoreScroll: (tab: LayerTab) => void;
  /** Shown instead of the tabs while the layer is being written, or when it can't be. */
  children?: React.ReactNode;
}) {
  const ready = explained && source;
  const mountedExplained = useCallback(() => restoreScroll("explained"), [restoreScroll]);
  const mountedLecture = useCallback(() => restoreScroll("lecture"), [restoreScroll]);
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
          {!ready && draft && (draft.summary || draft.sections.length > 0) && (
            <div className="m-body" aria-busy="true">
              <ExplainedView writing explained={{ ...draft, version: 2, question: bigQuestion }} optional={[]} onCite={onCite} onMounted={mountedExplained} />
            </div>
          )}
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
                    { value: "lecture", label: "Lecture" },
                    { value: "source", label: "Source" },
                  ]}
                />
                <p className="m-bar-note" aria-live="polite">
                  {tab === "explained" ? "In plain English. Each page number in the margin jumps to the source." : tab === "lecture" ? "What the lecture did with this topic, counted from your slides." : "The exact text from your files, with its file and page."}
                </p>
              </div>
              <div className="m-body">
                <AnimatePresence mode="wait" initial={false}>
                  {tab === "explained" ? (
                    <ExplainedView key="explained" explained={explained} optional={optional} onCite={onCite} onMounted={mountedExplained} />
                  ) : tab === "lecture" ? (
                    <LectureView key="lecture" projectId={projectId} lecture={lecture} status={lectureStatus} onCite={onCite} onMounted={mountedLecture} onAddFiles={onAddFiles} onRetry={onRetryLecture} />
                  ) : (
                    <SourceView key="source" layerId={layerId} quotes={source} optional={optional} onMounted={mountedSource} />
                  )}
                </AnimatePresence>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
