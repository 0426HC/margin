"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { useLayoutEffect } from "react";
import { Button } from "@/components/ui/Button";
import { CitedText, type CiteHandler } from "@/components/ui/Citation";
import { MarginRow, type MarginMark } from "@/components/workspace/MarginGutter";
import type { LectureTab } from "@/lib/lecture/service";
import type { SlideRef } from "@/lib/lecture/types";
import { citeKey, liftCitations, useSwap } from "./reading-parts";

export type LectureStatus = { state: "idle" | "writing" | "error"; error?: string };

function Slides({ slides, onCite }: { slides: SlideRef[]; onCite: CiteHandler }) {
  return (
    <>
      {slides.map((s, i) => (
        <span key={citeKey(s.file, s.page)}>
          {i > 0 && ", "}
          <button type="button" className="m-cite-inline" onClick={() => onCite(s.page, s.file)} aria-label={`${s.file}, slide ${s.page}. Show the slide`}>
            {s.page}
          </button>
        </span>
      ))}
    </>
  );
}

/** What Margin counted from the slides. Every number here is counted by code and every line is copied as written. */
function Facts({ facts, onCite }: { facts: NonNullable<LectureTab["content"]>["facts"]; onCite: CiteHandler }) {
  const multi = facts.files.length > 1;
  return (
    <section aria-label="By the numbers" className="m-lec-facts-wrap">
      <MarginRow kind="title" marks={[]}>
        <h3>By the numbers</h3>
      </MarginRow>
      <MarginRow marks={[]}>
        <div>
          <dl className="m-lec-facts">
            <div>
              <dt>Slides</dt>
              <dd>
                {facts.slides} {facts.slides === 1 ? "slide" : "slides"} in this layer{multi ? "" : `, from ${facts.files[0]?.name}`}
                {multi && `, from ${facts.files.map((f) => `${f.name} (${f.slides})`).join(", ")}`}
              </dd>
            </div>
            {facts.terms.length > 0 && (
              <div>
                <dt>Most slides on</dt>
                <dd>
                  {facts.terms.map((t, i) => (
                    <span key={t.term} className="m-lec-item">
                      {i > 0 && " · "}
                      <b>{t.term}</b> on {t.slides.length} slides (<Slides slides={t.slides} onCite={onCite} />)
                    </span>
                  ))}
                </dd>
              </div>
            )}
            {facts.longest.length > 0 && (
              <div>
                <dt>Most on one slide</dt>
                <dd>
                  {facts.longest.map((s, i) => (
                    <span key={citeKey(s.file, s.page)} className="m-lec-item">
                      {i > 0 && " · "}
                      <Slides slides={[s]} onCite={onCite} /> {s.title ? `“${s.title}”` : ""} ({s.words} words)
                    </span>
                  ))}
                </dd>
              </div>
            )}
            {facts.repeated.length > 0 && (
              <div>
                <dt>Repeated</dt>
                <dd>
                  {facts.repeated.map((r, i) => (
                    <span key={r.phrase} className="m-lec-item">
                      {i > 0 && " · "}“{r.phrase}” on slides <Slides slides={r.slides} onCite={onCite} />
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </dl>
          <p className="m-lec-note">Counted by Margin from your slides. The words below were written from these numbers and checked against the slides.</p>
        </div>
      </MarginRow>
    </section>
  );
}

/** The student's own notes for the weeks this layer draws on, only the lines about this layer. They are the student's words, never the professor's. */
function ClassNotes({ projectId, notes, onCite }: { projectId: string; notes: NonNullable<LectureTab["content"]>["notes"]; onCite: CiteHandler }) {
  if (!notes.weeksDrawn.length) return null;
  return (
    <>
      {notes.weeks.map((w) => (
        <section key={w.week} aria-label={`From your class notes, Week ${w.week}`} className="m-lec-notes">
          <MarginRow kind="title" marks={[]}>
            <h3>From your class notes · Week {w.week}</h3>
          </MarginRow>
          <MarginRow marks={[]}>
            <div>
              <p className="m-lec-note">Your own words{w.date ? `, ${w.date}` : ""}. These are not the professor’s words.</p>
              {w.lines.length ? (
                <ul className="m-lec-own">
                  {w.lines.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              ) : (
                <p className="m-lec-none">None of your Week {w.week} notes are about this layer.</p>
              )}
            </div>
          </MarginRow>
        </section>
      ))}
      {notes.empty.length > 0 && (
        <MarginRow marks={[]}>
          <p className="m-lec-none">
            {notes.empty.length === 1
              ? `You haven’t written notes for Week ${notes.empty[0]} yet.`
              : `You haven’t written notes for Weeks ${notes.empty.join(", ")} yet.`}{" "}
            <Link href={`/p/${projectId}/lecture-notes/${notes.empty[0]}`}>Open Lecture notes</Link>
          </p>
        </MarginRow>
      )}
      {notes.checks.length > 0 && (
        <section aria-label="A second look" className="m-lec-notes">
          <MarginRow kind="title" marks={[]}>
            <h3>A second look</h3>
          </MarginRow>
          <MarginRow marks={[]}>
            <ul className="m-lec-checks">
              {notes.checks.map((c, i) => (
                <li key={i}>
                  <CitedText text={c} onCite={onCite} />
                </li>
              ))}
            </ul>
          </MarginRow>
        </section>
      )}
    </>
  );
}

/**
 * The Lecture tab: what the lecture did with this layer, written from the layer's own lecture files only (numbers counted by code, prose
 * checked like Explained), then the student's own lecture notes that bear on it. With no lecture files it says so and offers Add files.
 */
export function LectureView({
  projectId,
  lecture,
  status,
  onCite,
  onMounted,
  onAddFiles,
  onRetry,
}: {
  projectId: string;
  lecture: LectureTab;
  status: LectureStatus;
  onCite: CiteHandler;
  onMounted: () => void;
  onAddFiles: () => void;
  onRetry: () => void;
}) {
  const swap = useSwap();
  useLayoutEffect(onMounted, [onMounted]);
  const marksOf = (cites: { file: string; page: number }[], near: string): MarginMark[] =>
    cites.map((c) => ({ kind: "cite", page: c.page, file: c.file, onJump: onCite, near }));
  const c = lecture.content;
  return (
    <motion.div {...swap} id="reading-panel" role="tabpanel" aria-labelledby="layer-view-lecture" className="m-explained m-lecture">
      {!lecture.files.length && (
        <MarginRow marks={[]}>
          <div className="m-lec-empty">
            <h3>No lecture files for this layer yet</h3>
            <p>
              Add the slides or notes from the lecture and label them Lecture. Margin then shows what the lecture spent its time on, what it repeated, and how
              it differs from the reading.
            </p>
            <Button variant="accent" onClick={onAddFiles}>
              Add files
            </Button>
          </div>
        </MarginRow>
      )}
      {lecture.files.length > 0 && !c && status.state !== "error" && (
        <p className="m-note" role="status">
          Writing the Lecture view from {lecture.files.length === 1 ? lecture.files[0] : `${lecture.files.length} lecture files`}. The first time takes about a
          minute; after that it opens at once.
        </p>
      )}
      {status.state === "error" && (
        <div className="m-note" role="alert">
          <p>{status.error}</p>
          <Button variant="accent" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
      {c && (
        <>
          <Facts facts={c.facts} onCite={onCite} />
          {c.writing.blocks.map((b, i) => {
            if (b.type === "heading")
              return (
                <MarginRow key={i} kind="title" marks={[]}>
                  <h3>{b.text}</h3>
                </MarginRow>
              );
            if (b.type === "none")
              return (
                <MarginRow key={i} marks={[]}>
                  <p className="m-lec-none">{b.text}</p>
                </MarginRow>
              );
            if (b.type === "paragraph") {
              const { body, cites } = liftCitations(b.text);
              return (
                <MarginRow key={i} marks={marksOf(cites, body)}>
                  <p>{body}</p>
                </MarginRow>
              );
            }
            const lifted = b.items.map(liftCitations);
            const cites = [...new Map(lifted.flatMap((l) => l.cites).map((x) => [citeKey(x.file, x.page), x])).values()];
            return (
              <MarginRow key={i} marks={marksOf(cites, lifted.map((l) => l.body).join(" "))}>
                <ul>
                  {lifted.map((l, j) => (
                    <li key={j}>{l.body}</li>
                  ))}
                </ul>
              </MarginRow>
            );
          })}
          <ClassNotes projectId={projectId} notes={c.notes} onCite={onCite} />
        </>
      )}
    </motion.div>
  );
}
