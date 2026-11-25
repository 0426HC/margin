"use client";

import { WeeksArt } from "@/components/art/WeeksArt";
import type { WeekSummary } from "@/lib/weeks/notes";
import { StoryScene } from "./StoryScene";

/** The Lecture notes scene: a sheet standing in a row for every week; scroll on the sheets to walk the hero to a week, click to open it. */
export function WeeksScene({ projectId, weeks, current, reduced, sceneRef, enter }: { projectId: string; weeks: WeekSummary[]; current: number; reduced: boolean; sceneRef: (el: HTMLElement | null) => void; enter?: boolean }) {
  const written = weeks.filter((w) => w.hasNotes).length;
  return (
    <StoryScene
      id="ov-weeks"
      eyebrow="Week by week"
      title="Lecture notes"
      why="One page of your own notes for every week of lectures."
      status={`${written} of ${weeks.length} ${weeks.length === 1 ? "week has" : "weeks have"} notes`}
      art={<WeeksArt weeks={weeks} current={current} projectId={projectId} />}
      reduced={reduced}
      sceneRef={sceneRef}
      enter={enter}
    />
  );
}
