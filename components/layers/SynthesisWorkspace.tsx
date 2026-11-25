"use client";

import Link from "next/link";
import { BackToCourse } from "@/components/shell/BackToCourse";
import { useState } from "react";
import { Workspace } from "@/components/workspace/Workspace";
import { LayerMark } from "@/components/ui/LayerMark";
import type { GuideSlot } from "@/lib/layers/note-to-self";
import type { StructureModel } from "@/lib/layers/types";
import { LayerList } from "./LayerList";
import { RightPane, useRightTab } from "./RightPane";
import { SourceViewer, type CiteTarget } from "./SourceViewer";
import { useCollectOnLeave } from "@/components/talk/activity";
import { TalkPane } from "./TalkPane";
import { WriteBack } from "./WriteBack";

/**
 * A week synthesis (optional) in the same three panes as a layer: the layer list, the week's layers (titles, questions and what I saved)
 * to write from, and the same write-back loop. Never locked and never counted in progress: unfinished layers are noted, not required.
 */
export function SynthesisWorkspace({ model, weekId, question, layers }: { model: StructureModel; weekId: string; question: string; layers: GuideSlot[] }) {
  const [cited, setCited] = useState<CiteTarget | null>(null);
  const [rightTab, setRightTab] = useRightTab();
  const week = model.weeks.find((w) => w.id === weekId)!;
  const partId = weekId; // the synthesis is stored against the week's row
  const projectId = model.project.id;
  const open = layers.filter((l) => !l.final);
  const gated = week.status !== "approved";
  useCollectOnLeave(projectId, rightTab === "talk");

  // A citation in the feedback opens the original page in the slide-over, with the cited passage marked.
  const cite = (page: number, file: string, near?: string) => setCited({ file, page, near });

  return (
    <>
    <Workspace
      leftTitle="Layers"
      listName="layer list"
      rightName="synthesis pane"
      topbar={
        <>
          <BackToCourse projectId={projectId} course={model.project.name} own="layers" />
          <span className="t-label text-panel-muted" style={{ marginLeft: "auto" }}>
            {week.label}, synthesis
          </span>
        </>
      }
      left={<LayerList model={model} activeId={`synthesis-${partId}`} />}
      leftFooter={
        <>
          <Link href={`/p/${projectId}/notes`} className="m-left-link">
            <span>Note to Self</span>
          </Link>
          <button type="button" className="m-left-link" onClick={() => setRightTab("talk")}>
            <span>Let&rsquo;s talk!</span>
          </button>
          <Link href={`/p/${projectId}/lecture-notes`} className="m-left-link">
            <span>Lecture notes</span>
          </Link>
          <Link href={`/p/${projectId}/exam`} className="m-left-link">
            <span>Exam room</span>
          </Link>
        </>
      }
      right={
        <RightPane
          tab={rightTab}
          onTab={setRightTab}
          writeLabel="Write the synthesis"
          write={gated ? <aside className="m-chat m-panel surface-desk" aria-label="Write the synthesis"><p className="t-ui m-write-empty" style={{ padding: 18 }}>Approve the course plan first, then write the week’s synthesis.</p></aside> : <WriteBack key={partId} kind="synthesis" base={`/api/parts/${partId}/synthesis`} draftId={`synthesis-${partId}`} state={week.synthesis} onCite={cite} />}
          talk={<TalkPane projectId={projectId} onCite={cite} from={{ partId }} fromLabel={`From ${week.label} synthesis`} />}
        />
      }
    >
      <section className="m-paper m-reading-pane" aria-label={`${week.label} synthesis`}>
        <div className="m-scroll">
          <div className="m-reading">
            <header className="m-head">
              <p className="m-part-tag">{week.label} · optional</p>
              <h1 className="t-h1">Tie week {week.week} together</h1>
              <p className="m-subtitle">{question}</p>
            </header>
            {gated ? (
              <p className="m-note" role="status">
                The course plan isn&rsquo;t approved yet. <Link href={`/p/${projectId}/setup`}>Approve it first.</Link>
              </p>
            ) : (
              <p className="m-note" role="status">
                {open.length === 0
                  ? "Every layer of this week is saved to Note to Self. Write one piece that ties them together: what each idea adds, and how they build on each other. It is optional and doesn't count toward your progress."
                  : open.length === layers.length
                    ? "None of this week’s layers is saved yet. You can write the synthesis now; the review will point out what is missing. It is optional."
                    : `${open.length} of ${layers.length} layers aren’t saved yet. You can write the synthesis now; the review will point out what is missing.`}
              </p>
            )}
            <div className="m-synth-layers">
              <h2 className="m-synth-h">This week&rsquo;s layers</h2>
              {layers.map((l, i) => (
                <article key={l.id} className="m-gutter-row m-synth-layer" data-waiting={l.final ? undefined : ""}>
                  <p className="m-margin-note m-synth-side">
                    <LayerMark state={l.state} withLabel />
                    <span>Layer {i + 1}</span>
                  </p>
                  <div className="min-w-0">
                    <h3 className="m-synth-title">
                      <Link href={`/p/${projectId}/l/${l.id}`}>{l.title}</Link>
                    </h3>
                    {l.bigQuestion && <p className="m-synth-q">{l.bigQuestion}</p>}
                    {l.final ? (
                      <div className="m-synth-text">
                        {l.final.text.split(/\n{2,}/).map((para, k) => (
                          <p key={k}>{para}</p>
                        ))}
                      </div>
                    ) : (
                      <p className="m-synth-q">
                        Not saved yet. <Link href={`/p/${projectId}/l/${l.id}`}>Open the layer</Link>
                      </p>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>
    </Workspace>
    <SourceViewer projectId={projectId} target={cited} onClose={() => setCited(null)} />
    </>
  );
}
