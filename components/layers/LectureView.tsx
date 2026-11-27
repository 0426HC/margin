"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { useLayoutEffect, useMemo } from "react";
import { Button } from "@/components/ui/Button";
import type { CiteHandler } from "@/components/ui/Citation";
import { MarginRow, type MarginMark } from "@/components/workspace/MarginGutter";
import type { LecturePart } from "@/lib/lecture/progress";
import type { LectureSection, WeekLecture } from "@/lib/lecture/service";
import { FROM_NOTES, readLectureText } from "@/lib/lecture/text";
import { citeKey, liftCitations, useSwap } from "./reading-parts";

/** The week's Lecture tab as the page holds it: what is stored, the text of any section being written now, and what went wrong. */
export interface LectureState {
  tab: WeekLecture;
  writing: Partial<Record<LecturePart, string>>;
  error: string | null;
}

/** Text with "(from your notes)" set apart, so a point that comes only from the student's notes is plain to see. */
function Marked({ text }: { text: string }) {
  const parts = text.split(FROM_NOTES);
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && <span className="m-lec-own">{FROM_NOTES}</span>}
        </span>
      ))}
    </>
  );
}

/** A section's text, block by block, citations lifted into the margin. */
function Blocks({ text, onCite }: { text: string; onCite: CiteHandler }) {
  const blocks = useMemo(() => readLectureText(text), [text]);
  const marksOf = (cites: { file: string; page: number }[], near: string): MarginMark[] => cites.map((c) => ({ kind: "cite", page: c.page, file: c.file, onJump: onCite, near }));
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === "part")
          return (
            <MarginRow key={i} kind="title" marks={[]}>
              <h4 className="m-lec-part">{b.text}</h4>
            </MarginRow>
          );
        if (b.type === "topic")
          return (
            <MarginRow key={i} kind="title" marks={[]}>
              <h5 className="m-lec-topic">{b.text}</h5>
            </MarginRow>
          );
        if (b.type === "paragraph") {
          const { body, cites } = liftCitations(b.text);
          return (
            <MarginRow key={i} marks={marksOf(cites, body)}>
              <p>
                <Marked text={body} />
              </p>
            </MarginRow>
          );
        }
        const lifted = b.items.map(liftCitations);
        const cites = [...new Map(lifted.flatMap((l) => l.cites).map((x) => [citeKey(x.file, x.page), x])).values()];
        return (
          <MarginRow key={i} marks={marksOf(cites, lifted.map((l) => l.body).join(" "))}>
            <ul>
              {lifted.map((l, j) => (
                <li key={j}>
                  <Marked text={l.body} />
                </li>
              ))}
            </ul>
          </MarginRow>
        );
      })}
    </>
  );
}

/**
 * One section: while it is written again, a small "updating" line, the version written before until the new text's first words, then
 * the new text as it arrives; with nothing written yet, one line saying what it is being written from until the text starts.
 */
function Section({ label, stored, live, waiting, updating, onCite }: { label: string; stored: LectureSection | null; live: string | undefined; waiting: string; updating: string; onCite: CiteHandler }) {
  const id = `lec-${label.replace(/\W+/g, "-").toLowerCase()}`;
  const arriving = live !== undefined && live.trim().length > 0;
  return (
    <section className="m-lec-section" aria-labelledby={id} aria-busy={live !== undefined}>
      <MarginRow kind="title" marks={[]}>
        <h3 id={id}>{label}</h3>
      </MarginRow>
      {live !== undefined && (stored || !arriving) && (
        <MarginRow marks={[]}>
          <p className="m-lec-note" role="status">
            {stored ? updating : waiting}
          </p>
        </MarginRow>
      )}
      {arriving ? <Blocks text={live} onCite={onCite} /> : stored && <Blocks text={stored.text} onCite={onCite} />}
    </section>
  );
}

/**
 * The Lecture tab of a week, the same in every layer of that week: "From your lecture notes" (the student's notes, expanded from the week's
 * material and pointed back to it) and "From the lecture material" (what the lecture spent its time on, what it stressed, its examples,
 * where it differs from the readings). Notes but no material: the first section only. Material but no notes: the second, with one line
 * inviting notes.
 */
export function LectureView({ projectId, state, onCite, onMounted, onRetry }: { projectId: string; state: LectureState; onCite: CiteHandler; onMounted: () => void; onRetry: () => void }) {
  const swap = useSwap();
  useLayoutEffect(onMounted, [onMounted]);
  const { tab, writing, error } = state;
  const files = tab.files.length === 1 ? tab.files[0] : `${tab.files.length} lecture files`;
  return (
    <motion.div {...swap} id="reading-panel" role="tabpanel" aria-labelledby="layer-view-lecture" className="m-explained m-lecture">
      <MarginRow marks={[]}>
        <p className="m-lec-note">Week {tab.week}. The same in every layer of this week.</p>
      </MarginRow>
      {tab.hasNotes ? (
        <Section
          label="From your lecture notes"
          stored={tab.notes}
          live={writing.notes}
          waiting={`Reading your Week ${tab.week} notes against the week’s readings and lecture material…`}
          updating="Updating from your latest notes…"
          onCite={onCite}
        />
      ) : (
        <section className="m-lec-section" aria-labelledby="lec-from-your-lecture-notes">
          <MarginRow kind="title" marks={[]}>
            <h3 id="lec-from-your-lecture-notes">From your lecture notes</h3>
          </MarginRow>
          <MarginRow marks={[]}>
            <p className="m-lec-none">
              Take notes in <Link href={`/p/${projectId}/lecture-notes/${tab.week}`}>Lecture notes</Link> during class and this section fills in.
            </p>
          </MarginRow>
        </section>
      )}
      {tab.files.length > 0 && (
        <Section
          label="From the lecture material"
          stored={tab.material}
          live={writing.material}
          waiting={`Reading ${files} for what the lecture spent its time on…`}
          updating="Updating: this week’s lecture files changed…"
          onCite={onCite}
        />
      )}
      {error && (
        <MarginRow marks={[]}>
          <div className="m-note" role="alert">
            <p>{error}</p>
            <Button variant="accent" onClick={onRetry}>
              Try again
            </Button>
          </div>
        </MarginRow>
      )}
    </motion.div>
  );
}
