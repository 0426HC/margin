"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ExamDeskArt } from "@/components/art/ExamDeskArt";
import type { ExamListItem } from "@/lib/exam/service";
import type { ExamSummary } from "@/lib/exam/types";
import { StoryScene } from "./StoryScene";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const lineOf = (e: ExamListItem) =>
  e.status === "unread" ? `${e.title}: sheet not read yet` : e.status === "check" ? `${e.title}: summary waiting for you to check it` : e.last ? `${e.title}: last attempt ${e.last.earned} of ${e.last.total} marks` : e.sets ? `${e.title}: ${plural(e.sets, "practice set")}, not sat yet` : `${e.title}: ready to practise`;

const hours = (m: number) => (m % 60 === 0 ? plural(m / 60, "hour") : m > 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} minutes`);

/** The small callouts beside the desk: the time, the first two sections, what it covers. */
export function examCallouts(s: ExamSummary): { text: string }[] {
  const time = [s.lengthMinutes ? hours(s.lengthMinutes) : null, s.totalMarks ? `${s.totalMarks} marks` : null].filter(Boolean).join(" · ");
  const covers = s.topics.length ? `Covers ${s.topics.join(", ")}` : s.weeks.length ? `Covers weeks ${s.weeks.join(", ")}` : null;
  return [time || null, ...s.sections.slice(0, 2).map((x) => `${x.name} · ${x.instructions || `${x.count} questions`}`), covers].filter((t): t is string => !!t).map((text) => ({ text }));
}

/**
 * The exam room scene: the Margin hero writing on a big exam paper at a wooden desk, and the exam's sections beside it, from this course's
 * own sheet. Without a sheet (or before it is read) the desk is empty: no callouts, never another course's exam.
 */
export function ExamScene({ projectId, exams, sheet, reduced, sceneRef, enter }: { projectId: string; exams: ExamListItem[]; sheet: ExamSummary | null; reduced: boolean; sceneRef: (el: HTMLElement | null) => void; enter?: boolean }) {
  const callouts = useMemo(() => (sheet ? examCallouts(sheet) : []), [sheet]);
  const first = exams[0];
  return (
    <StoryScene
      id="ov-exam"
      eyebrow={first ? [first.title, sheet?.date].filter(Boolean).join(" · ") : "Midterm and final"}
      title="The exam room"
      why="Practice in your exam’s format, built from your course. These are not predicted questions."
      status={first ? exams.map(lineOf).join(" · ") : "No exam sheet yet"}
      action={
        <Link href={`/p/${projectId}/exam`} className="ov-end-primary">
          {exams.length ? "Open the exam room" : "Add an exam sheet"}
        </Link>
      }
      art={
        sheet ? (
          <ExamDeskArt callouts={callouts} label={`An exam desk with a big exam paper; the Margin hero writes the answers. ${callouts.map((c) => c.text).join(". ")}`} />
        ) : (
          <ExamDeskArt blank label="An empty exam desk with a blank paper: no exam sheet has been read for this course yet" />
        )
      }
      reduced={reduced}
      sceneRef={sceneRef}
      enter={enter}
    />
  );
}
