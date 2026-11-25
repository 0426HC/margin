"use client";

import Link from "next/link";
import { BackToCourse } from "@/components/shell/BackToCourse";
import { useState } from "react";
import { LayerList } from "@/components/layers/LayerList";
import { Segmented } from "@/components/ui/Segmented";
import { NotepadTab } from "@/components/talk/NotepadTab";
import { Workspace } from "@/components/workspace/Workspace";
import type { StructureModel } from "@/lib/layers/types";
import type { WeekSummary } from "@/lib/weeks/notes";
import { WeekCounter } from "./WeekCounter";

/**
 * Lecture notes: the section beside the weeks and Let's talk!. Opening it shows the rolling counter; clicking a number opens that
 * week's notepad (the same page as the Let's talk! notepad, one per week). Same three-pane shell, without the right pane.
 */
export function WeeksSection({ model, weeks, view, embedded = false }: { model: StructureModel; weeks: WeekSummary[]; view: { kind: "all"; start: number } | { kind: "week"; week: number }; embedded?: boolean }) {
  const projectId = model.project.id;
  const [week, setWeek] = useState(view.kind === "week" ? view.week : 1);
  const choose = (w: number) => {
    setWeek(w);
    window.history.replaceState(null, "", `/p/${projectId}/lecture-notes/${w}`);
  };

  return (
    <Workspace
      leftTitle="Layers"
      listName="layer list"
      topbar={
        // inside the course page (lock in) its own top bar and tabs are above, so this one is left out
        embedded ? undefined : (
        <>
          <BackToCourse projectId={projectId} course={model.project.name} own="lecture-notes" />
          <span className="t-label text-panel-muted" style={{ marginLeft: "auto" }}>
            Lecture notes
          </span>
        </>
      )
      }
      left={<LayerList model={model} activeId="weeks" />}
      leftFooter={
        <>
          <Link href={`/p/${projectId}/notes`} className="m-left-link">
            <span>Note to Self</span>
          </Link>
          <Link href={`/p/${projectId}/talk`} className="m-left-link">
            <span>Let&rsquo;s talk!</span>
          </Link>
          <Link href={`/p/${projectId}/lecture-notes`} className="m-left-link" aria-current="page">
            <span>Lecture notes</span>
          </Link>
          <Link href={`/p/${projectId}/exam`} className="m-left-link">
            <span>Exam room</span>
          </Link>
        </>
      }
    >
      <section className="m-paper m-reading-pane m-tt wk" aria-label="Lecture notes">
        <div className="m-tt-head">
          <div>
            <p className="m-part-tag">{model.project.name}</p>
            <h1 className="t-h1">Lecture notes</h1>
          </div>
          {view.kind === "week" && (
            <Link href={`/p/${projectId}/lecture-notes?at=${week}`} className="m-btn" data-variant="secondary">
              All weeks
            </Link>
          )}
        </div>
        {view.kind === "all" ? (
          <WeekCounter projectId={projectId} weeks={weeks} start={view.start} />
        ) : (
          <>
            <div className="wk-bar">
              <div className="wk-tabs">
                <Segmented label="Weeks" idPrefix="week-tab" panelId="week-panel" value={String(week)} onChange={(v) => choose(Number(v))} options={weeks.map((w) => ({ value: String(w.week), label: `Week ${w.week}` }))} />
              </div>
            </div>
            <NotepadTab key={week} projectId={projectId} endpoint={`/api/projects/${projectId}/weeks/${week}/notes`} name={`Notes for Week ${week}`} panelId="week-panel" labelledBy={`week-tab-${week}`} />
          </>
        )}
      </section>
    </Workspace>
  );
}
